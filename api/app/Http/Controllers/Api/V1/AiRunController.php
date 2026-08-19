<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\AiFailureKind;
use App\Enums\AiRunType;
use App\Enums\DocumentStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\AiRunResource;
use App\Jobs\GenerateAiRunJob;
use App\Models\AiRun;
use App\Models\Document;
use App\Policies\AiRunPolicy;
use App\Services\AI\AiFailure;
use App\Services\AI\AiRunLedger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Throwable;

/**
 * AI runs (SPEC §14, §17). Generation is queued, so every request returns a run
 * the web polls to a terminal status — a slow model never blocks the page.
 *
 * Every action authorizes through {@see AiRunPolicy}, and the whole surface sits
 * behind the `ai.enabled` gate: with no Anthropic key configured these routes
 * 404, exactly as if they were never registered, so a keyless self-host has no
 * AI affordance to click.
 *
 * Nothing here writes review data. A digest is a displayed, copyable artifact —
 * the AI drafts, the human decides (hard rule 5).
 */
class AiRunController extends Controller
{
    /**
     * POST /api/v1/documents/{document}/ai/digest — request a review digest.
     *
     * 202 with a pending run when one is minted; 200 with the EXISTING run when
     * a digest for this document is already pending or running (eng review §8),
     * so a double-click or a second tab joins the run in flight instead of
     * billing the key twice. A retry after a failure is a fresh POST and mints a
     * new run — the failed one is never revived.
     */
    public function digest(Request $request, Document $document, AiRunLedger $ledger): JsonResponse
    {
        $this->authorize('create', [AiRun::class, $document]);

        abort_unless(
            $document->status === DocumentStatus::Ready && $document->current_version_id !== null,
            409,
            'Only a ready document can be digested.',
        );

        [$run, $created] = $ledger->startOrJoin($document, $request->user(), AiRunType::Digest);

        if ($created) {
            try {
                GenerateAiRunJob::dispatch($run->id);
            } catch (Throwable $e) {
                // The row is already committed, so a queue that refuses the job
                // would otherwise leave a pending run no worker will ever pick
                // up — and every later request would join that corpse. Fail it
                // here instead, so the author's retry mints a live run.
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
     * GET /api/v1/documents/{document}/ai/digest — the latest digest run for this
     * document, whatever its status, or 204 when none was ever requested.
     *
     * This is the panel's re-attach on mount (eng review §8): a run started
     * before a reload, or finished while the tab was closed, is picked back up
     * instead of being forgotten and re-billed.
     */
    public function latestDigest(Document $document, AiRunLedger $ledger): AiRunResource|Response
    {
        $this->authorize('viewAny', [AiRun::class, $document]);

        $run = $ledger->latestFor($document, AiRunType::Digest);

        return $run === null
            ? response()->noContent()
            : AiRunResource::make($run);
    }

    /**
     * GET /api/v1/ai-runs/{aiRun} — the polling target. Workspace-scoped; a
     * foreign id is denied 403, never confirmed to exist.
     */
    public function show(AiRun $aiRun): AiRunResource
    {
        $this->authorize('view', $aiRun);

        return AiRunResource::make($aiRun);
    }
}
