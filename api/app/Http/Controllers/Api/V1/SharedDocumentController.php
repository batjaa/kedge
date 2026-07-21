<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\SharedDocumentResource;
use App\Models\Share;
use App\Models\ShareParticipant;
use App\Services\Sharing\ShareLinkService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The public, read-only share surface (SPEC 10.2): `GET /api/v1/shared/{token}`.
 *
 * No authentication — the token *is* the capability. It grants exactly one
 * thing: reading the document it points at. There is no session, no other
 * document, and no other token reachable from here; the internal document id is
 * never exposed, so there is nothing to traverse to.
 *
 * A revoked, expired, or never-issued token all resolve to the same
 * distinguishable "gone" response (HTTP 410 with a machine-readable reason) —
 * never a bare 403/404, and never a signal of whether a token ever existed. The
 * web turns that into a friendly named page.
 *
 * Every response carries `X-Robots-Tag: noindex` so a "private link" stays out
 * of search indexes even if this API surface is hit directly.
 */
class SharedDocumentController extends Controller
{
    public function __construct(
        private readonly ShareLinkService $links,
    ) {}

    public function show(Request $request, string $token): JsonResponse
    {
        $share = $this->links->resolve($token);

        // Unknown, revoked, and expired all collapse to one "gone" answer. Unknown
        // reports `unknown` (indistinguishable from a typo'd link) — we never leak
        // that a token once existed.
        if ($share === null) {
            return $this->gone('unknown');
        }

        if (! $share->isActive()) {
            return $this->gone($share->goneReason() ?? 'unknown');
        }

        $participant = $this->verifiedParticipant($request, $share);
        $document = $share->document;
        if ($participant instanceof ShareParticipant) {
            $document->loadCurrentVersionAndApprovals();
        } else {
            $document->load('currentVersion');
        }

        return SharedDocumentResource::make($document)
            ->withReviewer($participant)
            ->response()
            ->header('X-Robots-Tag', 'noindex, nofollow');
    }

    /**
     * The distinguishable gone response (SPEC 10.2). 410 Gone with a reason the
     * web maps to friendly copy; noindex so it is never cached by a crawler.
     */
    private function gone(string $reason): JsonResponse
    {
        return response()
            ->json(['error' => 'share_gone', 'reason' => $reason], 410)
            ->header('X-Robots-Tag', 'noindex, nofollow');
    }

    private function verifiedParticipant(Request $request, Share $share): ?ShareParticipant
    {
        $user = $request->user();
        if ($user === null) {
            return null;
        }

        return $share->participants()
            ->where('user_id', $user->id)
            ->whereNotNull('verified_at')
            ->with('user')
            ->first();
    }
}
