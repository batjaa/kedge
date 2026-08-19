<?php

namespace App\Jobs;

use App\Enums\AiFailureKind;
use App\Models\AiRun;
use App\Services\AI\AiFailure;
use App\Services\AI\AiFailureClassifier;
use App\Services\AI\AiGeneratorRegistry;
use App\Services\AI\AiRunLedger;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * The single queued job behind every AI run (SPEC §14). It owns the lifecycle —
 * claim, generate, land — and knows nothing about what is being generated: the
 * registry resolves the generator for the run's type.
 *
 * Failure handling is the M1 deterministic/transient split (m4 eng review §5):
 * a transient fault is rethrown so the queue backs off and retries, and only the
 * exhausted attempt lands `failed()`; a deterministic fault lands the run failed
 * immediately, because a retry would bill the same key for the same answer.
 *
 * Stuck runs are impossible from this side (eng review §6): `$timeout` bounds the
 * work and `$failOnTimeout` routes the timeout straight to the terminal handler,
 * so a run can never sit `running` forever. The web poller's own ceiling covers
 * the remaining case — a worker killed so hard that `failed()` never runs.
 *
 * The run id travels, not the model: a job that outlives a row simply finds
 * nothing and stops.
 */
class GenerateAiRunJob implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $maxExceptions = 3;

    /**
     * A timeout is terminal, never a retry: the run lands `failed` and the
     * author retries deliberately with a fresh run.
     */
    public bool $failOnTimeout = true;

    /**
     * Sized for a chunked run (config), and carried on the job so a queued job
     * keeps the ceiling it was dispatched under.
     */
    public int $timeout;

    public function __construct(
        public readonly int $aiRunId,
    ) {
        $this->timeout = max(1, (int) config('kedge.ai.job_timeout', 300));
    }

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [10, 30, 60];
    }

    public function uniqueId(): string
    {
        return (string) $this->aiRunId;
    }

    public function handle(
        AiRunLedger $ledger,
        AiGeneratorRegistry $registry,
        AiFailureClassifier $classifier,
    ): void {
        $run = AiRun::query()->find($this->aiRunId);

        if ($run === null) {
            return;
        }

        // A terminal run is never reopened (append-only). A redelivery after the
        // run already landed does nothing.
        if (! $ledger->markRunning($run)) {
            return;
        }

        // The kill switch has to reach the workers too. Without this re-check, a
        // key pulled (or AI_ENABLED=false set) while runs sit in the queue would
        // still bill that key once per queued run — the gate would close the door
        // and leave the window open.
        //
        // Deliberately the SAME expression the request-time gate reads
        // (`kedge.ai.enabled`), so the two can never diverge on their RULE:
        // switching the selected provider to one with no credential (#140) stops
        // queued runs here exactly as it 404s new ones at the door.
        //
        // They can still diverge in TIME, and an operator should know it: a
        // worker holds the config it booted with, so pulling a key closes the
        // door immediately and stops the workers only once they recycle
        // (`queue:work --max-time`, or the deploy that restarts them). Making
        // the switch live would mean shared state read per job — deliberately
        // not in this gate.
        if (! config('kedge.ai.enabled', false)) {
            $ledger->markFailed($run, new AiFailure(
                AiFailureKind::Deterministic,
                'ai_disabled',
                'AI features are not enabled on this instance.',
            ));

            return;
        }

        try {
            $ledger->markCompleted($run, $registry->for($run)->generate($run));
        } catch (Throwable $e) {
            $failure = $classifier->classify($e);

            if ($failure->isTransient()) {
                Log::info('ai_run.retrying', [
                    'ai_run_id' => $run->id,
                    'type' => $run->type->value,
                    'attempt' => $this->attempts(),
                    'code' => $failure->code,
                ]);

                // Back off and retry; the exhausted attempt lands in failed().
                throw $e;
            }

            $ledger->markFailed($run, $failure);
        }
    }

    /**
     * The terminal handler: exhausted transient retries, a job timeout, or an
     * infrastructure failure all land the run `failed` here — never `running`.
     */
    public function failed(?Throwable $e): void
    {
        $run = AiRun::query()->find($this->aiRunId);

        if ($run === null) {
            return;
        }

        app(AiRunLedger::class)->markFailed($run, app(AiFailureClassifier::class)->classify($e));
    }
}
