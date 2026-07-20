<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\DocumentVersionResource;
use App\Models\Document;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class DocumentVersionController extends Controller
{
    public function index(Document $document): AnonymousResourceCollection
    {
        $this->authorize('view', $document);

        return DocumentVersionResource::collection(
            $document->versions()
                ->lineageOrdered()
                ->get(),
        );
    }
}
