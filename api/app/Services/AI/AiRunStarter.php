<?php

namespace App\Services\AI;

use App\Enums\AiFailureKind;
use App\Enums\AiRunType;
use App\Jobs\GenerateAiRunJob;
use App\Models\AiRun;
use App\Models\Document;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Throwable;

/**
 * "Mint or join a run, and make sure something is actually going to run it."
 *
 * The ledger owns the dedupe decision; this owns the consequence — dispatching
 * the job exactly once, for a run that was actually created, and refusing to
 * leave behind a pending row no worker will ever pick up.
 *
 * That last part is the subtle one: the run row is committed before the job is
 * queued, so a queue that refuses the dispatch would otherwise strand a `pending`
 * run that every LATER request joins (the dedupe probe can't tell a fresh run
 * from a stillborn one) — the author would be locked out of the feature until the
 * stale-run cutoff. Failing it here instead means the very next click mints a
 * live run.
 */
class AiRunStarter
{
    public function __construct(
        private readonly AiRunLedger $ledger,
    ) {}

    /**
     * @return array{AiRun, bool} the run, and whether this request minted it
     */
    public function start(
        Document $document,
        User $actor,
        AiRunType $type,
        ?Model $target = null,
        ?string $variant = null,
    ): array {
        [$run, $created] = $this->ledger->startOrJoin($document, $actor, $type, $target, $variant);

        if (! $created) {
            return [$run, false];
        }

        try {
            GenerateAiRunJob::dispatch($run->id);
        } catch (Throwable $e) {
            $this->ledger->markFailed($run, new AiFailure(
                AiFailureKind::Transient,
                'dispatch_failed',
                'Generation could not be queued. Retry.',
            ));

            report($e);
        }

        return [$run, true];
    }
}
