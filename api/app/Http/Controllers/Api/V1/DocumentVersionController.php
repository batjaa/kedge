<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\DocumentVersionDiffResource;
use App\Http\Resources\V1\DocumentVersionResource;
use App\Models\Document;
use App\Models\DocumentVersion;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class DocumentVersionController extends Controller
{
    public function index(Document $document): AnonymousResourceCollection
    {
        $this->authorize('view', $document);

        return DocumentVersionResource::collection(
            $document->versionsWithOrdinals()->get(),
        );
    }

    public function show(Document $document, DocumentVersion $version): DocumentVersionResource
    {
        $this->authorize('view', $document);

        abort_unless((int) $version->document_id === (int) $document->id, 404);

        return DocumentVersionResource::make($version)
            ->withProjectionSubstrate()
            ->withOrdinal($document->ordinalForVersionId((int) $version->id));
    }

    public function diff(
        Document $document,
        DocumentVersion $baseVersion,
        DocumentVersion $targetVersion,
    ): DocumentVersionDiffResource {
        $this->authorize('view', $document);

        abort_unless((int) $baseVersion->document_id === (int) $document->id, 404);
        abort_unless((int) $targetVersion->document_id === (int) $document->id, 404);

        return new DocumentVersionDiffResource($document, $baseVersion, $targetVersion);
    }
}
