<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\AiRunType;
use App\Enums\DocumentStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreReplyDraftRequest;
use App\Http\Resources\V1\AiRunResource;
use App\Models\AiRun;
use App\Models\Document;
use App\Models\Thread;
use App\Policies\AiRunPolicy;
use App\Services\AI\AiRunLedger;
use App\Services\AI\AiRunStarter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The thread-panel triage pair (SPEC §14, §17 — user stories 5 and 7): a reply
 * draft in the author's chosen stance, and a summary of a thread too long to
 * read.
 *
 * Both are generations over ONE thread, so they run the same ledger contract as
 * the document-wide digest — queued run, poll to terminal, dedupe in flight,
 * retry mints a new row — with the thread as the run's target. Both authorize
 * through {@see AiRunPolicy} against the thread's document (spending the
 * workspace's key is a member capability, not a share reviewer's), and both sit
 * behind the BYO-key gate, so a keyless instance has no triage affordance to
 * click rather than buttons that 404.
 *
 * Nothing here writes review data. A reply draft comes back as text the author
 * edits and posts through the ordinary reply endpoint; the AI never speaks as
 * them (hard rule 5).
 */
class AiThreadRunController extends Controller
{
    public function __construct(
        private readonly AiRunStarter $runs,
    ) {}

    /**
     * POST /api/v1/threads/{thread}/ai/reply-draft — draft a reply in `stance`.
     *
     * 202 with a new run, or 200 with the run already in flight FOR THAT STANCE.
     * The stance is part of the dedupe key on purpose: asking for a push-back
     * while an accept draft is still running is a different question, and being
     * handed the other answer would be worse than paying for a second call.
     */
    public function replyDraft(StoreReplyDraftRequest $request, Thread $thread): JsonResponse
    {
        $document = $this->authorizedDocument($thread);

        [$run, $created] = $this->runs->start(
            $document,
            $request->user(),
            AiRunType::ReplyDraft,
            $thread,
            $request->stance()->value,
        );

        return $this->respond($run, $created);
    }

    /**
     * POST /api/v1/threads/{thread}/ai/summary — summarize a long thread.
     */
    public function summary(Request $request, Thread $thread): JsonResponse
    {
        $document = $this->authorizedDocument($thread);

        [$run, $created] = $this->runs->start(
            $document,
            $request->user(),
            AiRunType::Summary,
            $thread,
        );

        return $this->respond($run, $created);
    }

    /**
     * GET /api/v1/threads/{thread}/ai/summary — the latest summary run for this
     * thread, whatever its status, or 204 when none was ever requested.
     *
     * The re-attach on mount (eng review §8), and the reason opening a summarized
     * thread is free: a summary someone already paid for is shown again rather
     * than re-generated.
     */
    public function latestSummary(Thread $thread, AiRunLedger $ledger): AiRunResource|Response
    {
        $document = $thread->document;

        abort_if($document === null, 404);

        $this->authorize('viewAny', [AiRun::class, $document]);

        $run = $ledger->latestFor($document, AiRunType::Summary, $thread);

        return $run === null
            ? response()->noContent()
            : AiRunResource::make($run);
    }

    /**
     * The thread's document, authorized and ready — in that order.
     *
     * The ORDER is the security property. Authorization runs before the readiness
     * check so a stranger walking thread ids always gets the same 403, whatever
     * state the document is in; checking readiness first would turn 409-vs-403
     * into an oracle telling an outsider which foreign documents finished
     * importing.
     *
     * Readiness itself is real: a generation is taken over the CURRENT version's
     * material, so a document still importing (or one whose import failed) has
     * nothing to summarize and nothing to reply against.
     */
    private function authorizedDocument(Thread $thread): Document
    {
        $document = $thread->document;

        // A thread with no document is a broken row, not a permission question.
        abort_if($document === null, 404);

        $this->authorize('create', [AiRun::class, $document]);

        abort_unless(
            $document->status === DocumentStatus::Ready && $document->current_version_id !== null,
            409,
            'Only a ready document can be read by AI.',
        );

        return $document;
    }

    private function respond(AiRun $run, bool $created): JsonResponse
    {
        return AiRunResource::make($run)
            ->response()
            ->setStatusCode($created ? 202 : 200);
    }
}
