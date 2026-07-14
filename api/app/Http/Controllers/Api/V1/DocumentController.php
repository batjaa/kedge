<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\DocumentFormat;
use App\Enums\DocumentStatus;
use App\Enums\SourceType;
use App\Enums\SyncStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDocumentRequest;
use App\Http\Resources\V1\DocumentResource;
use App\Jobs\ImportDocumentJob;
use App\Models\Document;
use App\Models\User;
use App\Models\Workspace;
use App\Policies\DocumentPolicy;
use App\Services\AuditLogger;
use App\Services\Import\ConnectorRegistry;
use App\Services\Import\Connectors\UploadConnector;
use App\Services\Import\TitleSynthesizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
     */
    private function createFromUrl(
        StoreDocumentRequest $request,
        Workspace $workspace,
        User $user,
        ConnectorRegistry $registry,
        TitleSynthesizer $titles,
    ): Document {
        $url = (string) $request->validated('url');
        $connector = $registry->match($url);

        if ($connector === null) {
            throw ValidationException::withMessages([
                'url' => 'This source type is not supported yet.',
            ]);
        }

        return Document::create([
            'workspace_id' => $workspace->id,
            'created_by' => $user->id,
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

        $document->load('currentVersion');

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

        $document->forceFill([
            'status' => DocumentStatus::Importing,
            'last_sync_status' => SyncStatus::Ok,
            'sync_error' => null,
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
}
