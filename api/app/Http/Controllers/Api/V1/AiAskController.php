<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\AiRunType;
use App\Enums\DocumentStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDocumentAskRequest;
use App\Http\Resources\V1\AiRunResource;
use App\Models\AiRun;
use App\Models\Document;
use App\Policies\AiRunPolicy;
use App\Services\AI\AiRunStarter;
use Illuminate\Http\JsonResponse;

/**
 * Ask about the doc (SPEC §14, §17 — user story 23, M4 #139).
 *
 * A reader selects a passage, or asks doc-wide, and poses a question in their
 * own words. The answer comes back as an ephemeral panel they can copy, and
 * that is the end of it: this controller has ONE action, and the surface has no
 * second endpoint that could turn an answer into a comment, a thread, or a
 * suggestion. Draft-only (hard rule 5) is trivially true here — there is no
 * write path to guard.
 *
 * There is also deliberately **no GET latest-ask**. Every other artifact has one
 * so a panel can re-attach to a run it started before a reload; an ask must not,
 * because "the answer disappeared when you closed it" IS the feature. Offering a
 * way back to it would make the ledger a place to go and read one, which is the
 * opposite of ephemeral. Polling still runs through the shared
 * `GET /ai-runs/{id}`, which the asker alone may read (the run is per-actor).
 *
 * Authorization is {@see AiRunPolicy} over the document — spending the
 * workspace's key is a member capability, not a share reviewer's — and the route
 * sits behind the `ai.enabled` gate, so a keyless instance 404s exactly as if it
 * were never registered and the web shows no affordance at all.
 */
class AiAskController extends Controller
{
    public function __construct(
        private readonly AiRunStarter $runs,
    ) {}

    /**
     * POST /api/v1/documents/{document}/ai/ask — ask a question about this
     * document.
     *
     * Always 202 with a NEW run. Unlike every other generation endpoint there is
     * no 200-join case: asks are dedupe-exempt
     * ({@see AiRunType::isDedupeExempt()}) because two questions about one
     * document are two different questions, and handing the second asker the
     * first one's answer would be confidently wrong rather than merely thrifty.
     * `throttle:ai` is what bounds the spend that dedupe would otherwise have
     * bounded.
     *
     * Single-turn, by construction: nothing about the run refers to a previous
     * one, so a follow-up is simply another ask.
     */
    public function store(StoreDocumentAskRequest $request, Document $document): JsonResponse
    {
        $this->authorize('create', [AiRun::class, $document]);

        // Authorization first, readiness second — the order is the security
        // property (see AiThreadRunController): checking readiness first would
        // turn 409-vs-403 into an oracle telling an outsider which foreign
        // documents finished importing.
        abort_unless(
            $document->status === DocumentStatus::Ready && $document->current_version_id !== null,
            409,
            'Only a ready document can be asked about.',
        );

        [$run] = $this->runs->start(
            $document,
            $request->user(),
            AiRunType::Ask,
            request: $request->askPayload(),
        );

        return AiRunResource::make($run)->response()->setStatusCode(202);
    }
}
