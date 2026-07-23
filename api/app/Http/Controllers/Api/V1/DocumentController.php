<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\DocumentFormat;
use App\Enums\DocumentStatus;
use App\Enums\LifecycleStatus;
use App\Enums\SourceType;
use App\Enums\SyncStatus;
use App\Enums\ThreadStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDocumentRequest;
use App\Http\Resources\V1\DocumentListResource;
use App\Http\Resources\V1\DocumentResource;
use App\Jobs\ImportDocumentJob;
use App\Jobs\ResyncDocumentJob;
use App\Models\Document;
use App\Models\User;
use App\Models\Workspace;
use App\Policies\DocumentPolicy;
use App\Services\AuditLogger;
use App\Services\Documents\DocumentLifecycleService;
use App\Services\Import\ConnectorRegistry;
use App\Services\Import\Connectors\UploadConnector;
use App\Services\Import\TitleSynthesizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The import API (SPEC 5.3). `store` accepts either a URL to fetch or content
 * pasted directly (#22), creates the document as `importing`, and hands the work
 * to a queued job — returning 202 at once so a slow source never blocks the UI.
 * `show` is the poll endpoint. `retry` re-runs a failed import. Every route
 * authorizes through {@see DocumentPolicy}.
 */
class DocumentController extends Controller
{
    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    /**
     * GET /api/v1/documents — the workspace's document list for the authenticated
     * home (SPEC 11; decisions 1A/4A/6A). `viewAny` authorizes (personal-workspace
     * holders only — a magic-link reviewer gets 403, never a 500); the query then
     * explicitly scopes to that workspace, so an id is never an access path and the
     * system workspace's demo docs fall outside the scope structurally. Newest
     * first, page-paginated with a clamped size; the lean per-row resource keeps
     * the home's cost flat as a workspace grows.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Document::class);

        $perPage = min(max((int) $request->integer('per_page', 20), 1), 50);

        $documents = $request->user()->personalWorkspace()->documents()
            ->with(['currentVersion' => fn ($query) => $query->select('id', 'document_id', 'synced_at')])
            ->withCount(['threads as open_threads_count' => fn ($query) => $query->where('status', ThreadStatus::Open->value)])
            // `created_at` is second-precision, so a stable tiebreaker is required:
            // without it same-second rows can order differently between page reads,
            // and a row straddling a page boundary can permute or silently drop.
            ->latest()
            ->orderByDesc('id')
            ->paginate($perPage);

        return DocumentListResource::collection($documents);
    }

    /**
     * POST /api/v1/documents — begin importing a document from a URL or from
     * pasted content. {@see StoreDocumentRequest} guarantees exactly one of the two.
     */
    public function store(
        StoreDocumentRequest $request,
        ConnectorRegistry $registry,
        TitleSynthesizer $titles,
    ): JsonResponse {
        $this->authorize('create', Document::class);

        $user = $request->user();
        $workspace = $user->personalWorkspace();

        $document = $request->filled('content')
            ? $this->createFromPaste($request, $workspace, $user)
            : $this->createFromUrl($request, $workspace, $user, $registry, $titles);

        $this->audit->record(
            $workspace,
            $user,
            'document.import_requested',
            $document,
            ['source_type' => $document->source_type->value, 'source_url' => $document->source_url],
            $request->ip(),
        );

        ImportDocumentJob::dispatch($document);

        return DocumentResource::make($document)
            ->response()
            ->setStatusCode(202);
    }

    /**
     * A URL import: match a connector (GitHub, raw, …) and record its provenance.
     *
     * When the workspace has a connected GitHub PAT (#23), a github.com blob URL is
     * imported through the authenticated connector — it reads private repos and
     * public ones alike — and the bound integration is recorded on the document so
     * the queued job authenticates with it.
     */
    private function createFromUrl(
        StoreDocumentRequest $request,
        Workspace $workspace,
        User $user,
        ConnectorRegistry $registry,
        TitleSynthesizer $titles,
    ): Document {
        $url = (string) $request->validated('url');

        $integration = $workspace->githubPatIntegration();
        $connector = $registry->preferredMatch($url, hasGithubPat: $integration !== null);

        if ($connector === null) {
            throw ValidationException::withMessages([
                'url' => 'This source type is not supported yet.',
            ]);
        }

        // Bind the integration only when the PAT reader was actually chosen — a raw
        // URL never carries one even if the workspace has a token.
        $boundIntegration = $connector->sourceType() === SourceType::GithubPat
            ? $integration
            : null;

        return Document::create([
            'workspace_id' => $workspace->id,
            'created_by' => $user->id,
            'integration_id' => $boundIntegration?->id,
            'source_type' => $connector->sourceType(),
            'source_url' => $url,
            'title' => $titles->filenameFrom($url),
            'format' => DocumentFormat::Md,
            'status' => DocumentStatus::Importing,
        ]);
    }

    /**
     * A paste/upload import: no URL and no re-sync source (SPEC 5.1). The body (and
     * an optional author title) live in `source_meta` so the queued job — and a
     * later retry — can re-import identical bytes; the {@see UploadConnector}
     * reads them back.
     */
    private function createFromPaste(
        StoreDocumentRequest $request,
        Workspace $workspace,
        User $user,
    ): Document {
        $title = (string) $request->validated('title');

        return Document::create([
            'workspace_id' => $workspace->id,
            'created_by' => $user->id,
            'source_type' => SourceType::Upload,
            'source_url' => null,
            'source_meta' => array_filter([
                'content' => (string) $request->validated('content'),
                'title' => $title,
            ], fn (string $value) => $value !== ''),
            // A placeholder until the import synthesizes the real title from the
            // first heading; an explicit author title wins immediately.
            'title' => $title !== '' ? $title : 'Untitled document',
            'format' => DocumentFormat::Md,
            'status' => DocumentStatus::Importing,
        ]);
    }

    /**
     * GET /api/v1/documents/{document} — poll status and read the rendered version.
     */
    public function show(Document $document): DocumentResource
    {
        $this->authorize('view', $document);

        return DocumentResource::make($document->loadCurrentVersionAndApprovals());
    }

    /**
     * PATCH /api/v1/documents/{document} — author-controlled lifecycle status.
     */
    public function update(Request $request, Document $document, DocumentLifecycleService $lifecycle): DocumentResource
    {
        $this->authorize('updateLifecycle', $document);

        $validated = $request->validate([
            'lifecycle_status' => ['required', Rule::enum(LifecycleStatus::class)],
        ]);

        $document = $lifecycle->update(
            $document,
            $request->user(),
            LifecycleStatus::from((string) $validated['lifecycle_status']),
            $request->ip(),
        );

        return DocumentResource::make($document);
    }

    /**
     * POST /api/v1/documents/{document}/retry — re-run a failed import (SPEC 19).
     */
    public function retry(Request $request, Document $document): JsonResponse
    {
        $this->authorize('update', $document);

        abort_unless(
            $document->status === DocumentStatus::Failed,
            409,
            'Only a failed import can be retried.',
        );

        // Rebind a PAT-sourced import to the workspace's current GitHub PAT before
        // re-queuing (#23, SPEC §19). A dead PAT that a user reconnected supersedes
        // the revoked one (`githubPatIntegration()` returns the latest); without
        // rebinding, the retry resolves the OLD integration_id and re-fails against
        // the revoked token. Left untouched when no PAT integration exists.
        $rebind = [];
        if ($document->source_type === SourceType::GithubPat) {
            $integration = $document->workspace->githubPatIntegration();
            if ($integration !== null) {
                $rebind['integration_id'] = $integration->id;
            }
        }

        $document->forceFill([
            'status' => DocumentStatus::Importing,
            'last_sync_status' => SyncStatus::Ok,
            'sync_error' => null,
            ...$rebind,
        ])->save();

        $this->audit->record(
            $document->workspace,
            $request->user(),
            'document.import_retried',
            $document,
            ip: $request->ip(),
        );

        ImportDocumentJob::dispatch($document);

        return DocumentResource::make($document)
            ->response()
            ->setStatusCode(202);
    }

    /**
     * POST /api/v1/documents/{document}/resync — manually pull the source again.
     */
    public function resync(Request $request, Document $document): JsonResponse
    {
        $this->authorize('resync', $document);

        abort_unless(
            $document->status === DocumentStatus::Ready && $document->current_version_id !== null,
            409,
            'Only a ready document can be re-synced.',
        );

        ResyncDocumentJob::dispatch($document, $request->user()?->id);

        return DocumentResource::make($document)
            ->response()
            ->setStatusCode(202);
    }
}
