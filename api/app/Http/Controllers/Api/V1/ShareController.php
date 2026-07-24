<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\AuditEvent;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreShareRequest;
use App\Http\Resources\V1\ShareResource;
use App\Models\Document;
use App\Models\Share;
use App\Policies\SharePolicy;
use App\Services\AuditLogger;
use App\Services\Sharing\ShareLinkService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Share-link management for a document's author (SPEC 10.2). Every action
 * authorizes through {@see SharePolicy} — a document id in a URL is never an
 * access path (SPEC 13). The public read surface lives in a separate,
 * unauthenticated controller; nothing here is reachable without a session.
 */
class ShareController extends Controller
{
    public function __construct(
        private readonly ShareLinkService $links,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * GET /api/v1/documents/{document}/shares — list a document's shares.
     *
     * Never resurrects a URL: only each share's state (the plaintext was shown
     * once, at creation, and is gone).
     */
    public function index(Document $document): AnonymousResourceCollection
    {
        $this->authorize('viewAny', [Share::class, $document]);

        $shares = $document->shares()->latest()->get();

        return ShareResource::collection($shares);
    }

    /**
     * POST /api/v1/documents/{document}/shares — mint an unguessable link.
     *
     * The full URL is returned exactly once, here — it embeds the only plaintext
     * copy of the token, which is otherwise never stored or shown again.
     */
    public function store(StoreShareRequest $request, Document $document): JsonResponse
    {
        $this->authorize('create', [Share::class, $document]);

        $issued = $this->links->issue(
            $document,
            $request->user(),
            $request->expiresAt(),
        );

        $this->audit->record(
            $document->workspace,
            $request->user(),
            AuditEvent::ShareCreated,
            $issued->share,
            ['expires_at' => optional($issued->share->expires_at)->toIso8601String()],
            $request->ip(),
        );

        return ShareResource::make($issued->share)
            ->withUrl($issued->url)
            ->response()
            ->setStatusCode(201);
    }

    /**
     * DELETE /api/v1/documents/{document}/shares/{share} — revoke a link.
     *
     * Idempotent: revoking an already-dead link just confirms it. Route-model
     * binding is scope-bound, so a share must belong to the document in the path.
     */
    public function destroy(Request $request, Document $document, Share $share): ShareResource
    {
        $this->authorize('delete', $share);

        if (! $share->isRevoked()) {
            $share->forceFill(['revoked_at' => now()])->save();

            $this->audit->record(
                $document->workspace,
                $request->user(),
                AuditEvent::ShareRevoked,
                $share,
                ip: $request->ip(),
            );
        }

        return ShareResource::make($share);
    }
}
