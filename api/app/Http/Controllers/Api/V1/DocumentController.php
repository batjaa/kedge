<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\DocumentFormat;
use App\Enums\DocumentStatus;
use App\Enums\SyncStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDocumentRequest;
use App\Http\Resources\V1\DocumentResource;
use App\Jobs\ImportDocumentJob;
use App\Models\Document;
use App\Policies\DocumentPolicy;
use App\Services\AuditLogger;
use App\Services\Import\ConnectorRegistry;
use App\Services\Import\TitleSynthesizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * The import API (SPEC 5.3). `store` accepts a URL, creates the document as
 * `importing`, and hands the fetch to a queued job — returning 202 at once so a
 * slow source never blocks the UI. `show` is the poll endpoint. `retry` re-runs
 * a failed import. Every route authorizes through {@see DocumentPolicy}.
 */
class DocumentController extends Controller
{
    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    /**
     * POST /api/v1/documents — begin importing a document from a URL.
     */
    public function store(
        StoreDocumentRequest $request,
        ConnectorRegistry $registry,
        TitleSynthesizer $titles,
    ): JsonResponse {
        $this->authorize('create', Document::class);

        $url = (string) $request->validated('url');
        $connector = $registry->match($url);

        if ($connector === null) {
            throw ValidationException::withMessages([
                'url' => 'This source type is not supported yet.',
            ]);
        }

        $user = $request->user();
        $workspace = $user->personalWorkspace();

        $document = Document::create([
            'workspace_id' => $workspace->id,
            'created_by' => $user->id,
            'source_type' => $connector->sourceType(),
            'source_url' => $url,
            'title' => $titles->filenameFrom($url),
            'format' => DocumentFormat::Md,
            'status' => DocumentStatus::Importing,
        ]);

        $this->audit->record(
            $workspace,
            $user,
            'document.import_requested',
            $document,
            ['source_url' => $url],
            $request->ip(),
        );

        ImportDocumentJob::dispatch($document);

        return DocumentResource::make($document)
            ->response()
            ->setStatusCode(202);
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
