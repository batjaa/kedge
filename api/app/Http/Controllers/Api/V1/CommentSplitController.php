<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\AiFailureKind;
use App\Enums\AiRunType;
use App\Enums\DocumentStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\AiRunResource;
use App\Jobs\GenerateAiRunJob;
use App\Models\AiRun;
use App\Models\Comment;
use App\Models\Document;
use App\Policies\AiRunPolicy;
use App\Services\AI\AiFailure;
use App\Services\AI\AiRunLedger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Throwable;

/**
 * AI comment-split proposals (SPEC §14 user story 6, §17 — M4 #134).
 *
 * The whole surface is READ-ONLY with respect to review data. A run produces a
 * list of proposals and stops there; a proposal becomes a thread only when the
 * author approves it and the web POSTs the ordinary
 * `/comments/{comment}/fork` — same Policy, same anchor validation, same
 * idempotency as a fork the author clicked by hand. There is deliberately no
 * "materialize" endpoint here: adding one would be the server writing review
 * data from model output, which hard rule 5 forbids.
 *
 * Authorization is {@see AiRunPolicy} over the comment's document — spending the
 * workspace's key is a member capability — and the whole group sits behind the
 * `ai.enabled` gate, so a keyless instance 404s exactly as if these routes were
 * never registered.
 */
class CommentSplitController extends Controller
{
    /**
     * POST /api/v1/comments/{comment}/ai/split — propose a split of this comment.
     *
     * 202 with a pending run when one is minted; 200 with the EXISTING run when
     * a split for THIS comment is already pending or running (eng review §8), so
     * a double-click or a second tab joins the run in flight instead of billing
     * the key twice. Runs are deduped per comment, not per document: two
     * sprawling comments on one document are two independent runs.
     */
    public function store(Request $request, Comment $comment, AiRunLedger $ledger): JsonResponse
    {
        $document = $this->splittableDocument($comment);

        // The reader tells us which version their page is showing. A split is
        // always generated against — and approved into — whatever the CURRENT
        // version is, so a stale page would offer the author anchors into
        // passages they cannot see. Making the server the authority turns that
        // from a UI race into a refusal; the web reloads and asks again.
        abort_if(
            $request->has('document_version_id')
                && $request->integer('document_version_id') !== (int) $document->current_version_id,
            409,
            'This document has a newer version. Reload before proposing a split.',
        );

        [$run, $created] = $ledger->startOrJoin($document, $request->user(), AiRunType::Split, $comment);

        if ($created) {
            try {
                GenerateAiRunJob::dispatch($run->id);
            } catch (Throwable $e) {
                // The row is already committed, so a queue that refuses the job
                // would otherwise leave a pending run no worker will ever pick
                // up — and every later request would join that corpse.
                $ledger->markFailed($run, new AiFailure(
                    AiFailureKind::Transient,
                    'dispatch_failed',
                    'Generation could not be queued. Retry.',
                ));

                report($e);

                return AiRunResource::make($run)->response()->setStatusCode(202);
            }
        }

        return AiRunResource::make($run)
            ->response()
            ->setStatusCode($created ? 202 : 200);
    }

    /**
     * GET /api/v1/comments/{comment}/ai/split — the latest split run for this
     * comment, whatever its status, or 204 when none was ever requested.
     *
     * The panel's re-attach on mount: a run started before a reload, or finished
     * while the tab was closed, is picked back up instead of being forgotten and
     * re-billed.
     */
    public function show(Comment $comment, AiRunLedger $ledger): AiRunResource|Response
    {
        $comment->loadMissing('thread.document');
        $this->authorize('viewAny', [AiRun::class, $comment->thread->document]);

        $run = $ledger->latestFor($comment->thread->document, AiRunType::Split, $comment);

        return $run === null
            ? response()->noContent()
            : AiRunResource::make($run);
    }

    /**
     * Authorize the request and refuse the comments a split could never be
     * materialized from.
     *
     * The guards mirror the fork endpoint's own preconditions on purpose: every
     * proposal this run makes is approved by calling fork, so proposing a split
     * of a comment fork will refuse is offering the author a list of dead
     * buttons. M2 forks REPLIES — forking a thread's opening comment would empty
     * the source thread — and a deleted comment has no issues left to divide.
     */
    private function splittableDocument(Comment $comment): Document
    {
        $comment->loadMissing(['thread.document', 'thread.comments']);
        $document = $comment->thread->document;

        $this->authorize('create', [AiRun::class, $document]);

        abort_unless(
            $document->status === DocumentStatus::Ready && $document->current_version_id !== null,
            409,
            'Only a ready document can be split.',
        );

        abort_if(
            $comment->trashed(),
            409,
            'A deleted comment cannot be split.',
        );

        abort_if(
            (int) $comment->thread->comments->sortBy('id')->first()?->id === (int) $comment->id,
            409,
            'Only a reply can be split into new threads.',
        );

        return $document;
    }
}
