<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\AuditEvent;
use App\Enums\DocumentFormat;
use App\Enums\DocumentLifecycleFilter;
use App\Enums\DocumentStatus;
use App\Enums\LifecycleStatus;
use App\Enums\SourceType;
use App\Enums\SyncStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDocumentRequest;
use App\Http\Requests\UpdateDocumentContentRequest;
use App\Http\Resources\V1\DocumentListResource;
use App\Http\Resources\V1\DocumentResource;
use App\Jobs\ImportDocumentJob;
use App\Jobs\ResyncDocumentJob;
use App\Models\Document;
use App\Models\Project;
use App\Models\User;
use App\Models\Workspace;
use App\Policies\DocumentPolicy;
use App\Services\AuditLogger;
use App\Services\Documents\DocumentLifecycleService;
use App\Services\Documents\DocumentProjectAssignment;
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

        // The lifecycle filter chips (SPEC §16, M3.7; #103). A closed set, so an
        // unknown value is a 422 rather than a silent no-op — and `from()` below
        // can never throw on garbage. Absent means All.
        $validated = $request->validate([
            'lifecycle' => ['sometimes', Rule::enum(DocumentLifecycleFilter::class)],
        ]);

        $perPage = min(max((int) $request->integer('per_page', 20), 1), 50);

        $query = $request->user()->personalWorkspace()->documents()
            ->with([
                'currentVersion' => fn ($query) => $query->select('id', 'document_id', 'synced_at'),
                // Lean identity for the row's project chip (id + name only).
                'project' => fn ($query) => $query->select('id', 'name'),
            ])
            // The per-row open-thread count reads the one shared "open" predicate
            // (Thread::scopeOpen), the same one the workspace summary counts (7A).
            ->withCount(['threads as open_threads_count' => fn ($query) => $query->open()]);

        // Reserved `?project=` filter (SPEC §17, M3.6): a numeric id scopes to
        // that project, the literal `unfiled` to the no-project bucket. The query
        // is already workspace-scoped, so a foreign project id matches nothing —
        // an empty page, never a leak.
        $project = $request->query('project');
        if ($project === 'unfiled') {
            $query->whereNull('project_id');
        } elseif ($project !== null && $project !== '') {
            $query->where('project_id', (int) $project);
        }

        // Server-side lifecycle filter (SPEC §16, M3.7; #103) through the ONE
        // shared predicate the summary counts each chip with (DocumentLifecycleFilter
        // → the lifecycle scopes / needsAttention). Applied before pagination, so
        // the filtered `meta.total` equals the chip's count across every page, not
        // just the loaded one (7A) — never a re-encoded predicate here. Amends
        // SPEC §16's old "no ?status=" note. `apply()` takes the relation's
        // underlying Eloquent builder (the workspace-scope constraint already lives
        // on it), the same Builder the summary's chip counts flow through.
        $builder = $query->getQuery();
        if (array_key_exists('lifecycle', $validated)) {
            $builder = DocumentLifecycleFilter::from($validated['lifecycle'])->apply($builder);
        }

        $documents = $builder
            // `created_at` is second-precision, so a stable tiebreaker is required:
            // without it same-second rows can order differently between page reads,
            // and a row straddling a page boundary can permute or silently drop.
            ->latest()
            ->orderByDesc('id')
            ->paginate($perPage)
            // Keep `?project=` on the paginator links so Load more stays scoped.
            ->withQueryString();

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
        DocumentProjectAssignment $projects,
    ): JsonResponse {
        $this->authorize('create', Document::class);

        $user = $request->user();
        $workspace = $user->personalWorkspace();

        // An optional target project (the import form on a project page, M3.6).
        // Resolved up front so a foreign id 404s (8A) before a document is minted.
        $project = $projects->resolve(
            $workspace,
            $request->filled('project_id') ? (int) $request->validated('project_id') : null,
        );

        $document = $request->filled('content')
            ? $this->createFromPaste($request, $workspace, $user, $project)
            : $this->createFromUrl($request, $workspace, $user, $registry, $titles, $project);

        $this->audit->record(
            $workspace,
            $user,
            AuditEvent::DocumentImportRequested,
            $document,
            ['source_type' => $document->source_type->value, 'source_url' => $document->source_url],
            $request->ip(),
        );

        ImportDocumentJob::dispatch($document);

        // Load the project so a project-page import's 202 carries the chip.
        return DocumentResource::make($document->load('project'))
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
        ?Project $project,
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
            'project_id' => $project?->id,
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
        ?Project $project,
    ): Document {
        $title = (string) $request->validated('title');

        return Document::create([
            'workspace_id' => $workspace->id,
            'project_id' => $project?->id,
            'created_by' => $user->id,
            'source_type' => SourceType::Upload,
            'source_url' => null,
            'source_meta' => $this->pasteSourceMeta((string) $request->validated('content'), $title),
            // A placeholder until the import synthesizes the real title from the
            // first heading; an explicit author title wins immediately.
            'title' => $title !== '' ? $title : 'Untitled document',
            'format' => DocumentFormat::Md,
            'status' => DocumentStatus::Importing,
        ]);
    }

    /**
     * The `source_meta` shape a pasted/uploaded document carries (SPEC §5.1): the
     * body — and an optional author title — so the {@see UploadConnector} (and any
     * retry) re-imports identical bytes. Empty values are dropped so an absent
     * title lets the importer synthesize one from the first heading. Shared by the
     * initial paste import and a later manual content update (#113) so both persist
     * an identical record of "the latest paste".
     *
     * @return array<string, string>
     */
    private function pasteSourceMeta(string $content, string $title): array
    {
        return array_filter([
            'content' => $content,
            'title' => $title,
        ], static fn (string $value): bool => $value !== '');
    }

    /**
     * GET /api/v1/documents/{document} — poll status and read the rendered version.
     */
    public function show(Document $document): DocumentResource
    {
        $this->authorize('view', $document);

        return DocumentResource::make($document->loadCurrentVersionAndApprovals()->load('project'));
    }

    /**
     * PATCH /api/v1/documents/{document} — author-controlled lifecycle status
     * and/or project assignment (M3.6). Both mutations are capability-gated the
     * same way (author only, via `updateLifecycle`); the request is partial, so a
     * caller sends whichever field changed. A `project_id` of null moves the
     * document back to Unfiled; a foreign project id 404s (8A).
     */
    public function update(
        Request $request,
        Document $document,
        DocumentLifecycleService $lifecycle,
        DocumentProjectAssignment $projects,
    ): DocumentResource {
        $this->authorize('updateLifecycle', $document);

        $validated = $request->validate([
            'lifecycle_status' => ['sometimes', Rule::enum(LifecycleStatus::class)],
            'project_id' => ['sometimes', 'nullable', 'integer'],
        ]);

        if (array_key_exists('project_id', $validated)) {
            $document = $projects->assign(
                $document,
                $validated['project_id'] !== null ? (int) $validated['project_id'] : null,
                $request->user(),
                $request->ip(),
            );
        }

        if (array_key_exists('lifecycle_status', $validated)) {
            $document = $lifecycle->update(
                $document,
                $request->user(),
                LifecycleStatus::from((string) $validated['lifecycle_status']),
                $request->ip(),
            );
        }

        return DocumentResource::make($document->loadCurrentVersionAndApprovals()->load('project'));
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
            AuditEvent::DocumentImportRetried,
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

    /**
     * POST /api/v1/documents/{document}/content — replace a pasted/uploaded
     * document's content, minting a new version through the SAME pipeline a
     * re-sync uses (#113; SPEC §5.1 "manual-only versioning", §7 re-sync
     * triggers). This is the spec-reserved manual versioning path an upload has
     * had no trigger for until now.
     *
     * Only an upload-sourced document qualifies — a URL-sourced document re-pulls
     * its source through {@see resync} instead, so its content is never
     * client-overwritten. The new body (and optional replacement title) overwrite
     * `documents.source_meta`, so the shared {@see UploadConnector} re-imports the
     * LATEST paste — including on a retry after a transient failure — and the
     * queued {@see ResyncDocumentJob} runs normalization → content-hash dedupe →
     * re-anchor ladder → approval-staleness → the re-anchor digest unchanged
     * (M3.8). A failed update never disturbs the current version (SPEC §5.3): the
     * pipeline flips `current_version_id` only after the target version's anchors
     * are durable.
     *
     * Deliberately NOT behind the `resync.enabled` rollout flag: that flag bounds
     * outbound fetch/queue load, and a content update spawns no outbound fetch —
     * it is the ONLY versioning path an upload has, so gating it there would
     * strand pasted documents.
     */
    public function updateContent(UpdateDocumentContentRequest $request, Document $document): JsonResponse
    {
        $this->authorize('resync', $document);

        abort_unless(
            $document->source_type === SourceType::Upload,
            409,
            'Only a pasted or uploaded document can have its content updated. Re-sync a URL-sourced document instead.',
        );

        abort_unless(
            $document->status === DocumentStatus::Ready && $document->current_version_id !== null,
            409,
            'Only a ready document can have its content updated.',
        );

        $document->forceFill([
            'source_meta' => $this->pasteSourceMeta(
                (string) $request->validated('content'),
                (string) ($request->validated('title') ?? ''),
            ),
        ])->save();

        ResyncDocumentJob::dispatch($document, $request->user()?->id);

        return DocumentResource::make($document)
            ->response()
            ->setStatusCode(202);
    }
}
