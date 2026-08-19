<?php

namespace App\Services\AI;

use App\Enums\AiFailureKind;
use App\Enums\AiRunStatus;
use App\Enums\AiRunType;
use App\Models\AiRun;
use App\Models\Document;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The one writer of the `ai_runs` ledger (SPEC §14, §16).
 *
 * Two rules are enforced here and nowhere else:
 *
 *  1. **Append-only.** Every write is a conditional UPDATE guarded on the
 *     status it expects, so a terminal run can never be moved — not by a
 *     redelivered job, not by a late `failed()` handler, not by a retry. A
 *     retry is a fresh POST that mints a NEW row, which is what keeps AI
 *     cost/day (SPEC §19) truthful across retries.
 *  2. **Server-side dedupe** (m4 eng review §8). A second request while a run of
 *     the same (document, type) is pending or running joins that run instead of
 *     minting one, so a double-click or a returning user can't double-bill. The
 *     probe runs under a lock on the document row, so two simultaneous requests
 *     serialize rather than racing into two rows.
 */
class AiRunLedger
{
    /**
     * Mint a run, or return the in-flight one for this (document, type).
     *
     * @return array{AiRun, bool} the run, and whether it was newly created
     */
    public function startOrJoin(Document $document, User $actor, AiRunType $type): array
    {
        [$run, $created] = DB::transaction(function () use ($document, $actor, $type): array {
            // Serialize concurrent requests for this document. Without it the
            // probe below is a check-then-act race and a double-click bills twice.
            Document::query()->whereKey($document->id)->lockForUpdate()->first();

            $existing = AiRun::query()
                ->where('document_id', $document->id)
                ->where('type', $type->value)
                ->inFlight()
                ->latest('id')
                ->first();

            // Stale-run takeover (the M3.6 scan idiom). A worker killed hard
            // enough never runs its terminal handler, so without this the dead
            // row would be joined by every later request forever and the author
            // could never get a digest again. Past the cutoff it is failed —
            // honestly, as an abandoned run keeping whatever it already spent —
            // and a replacement is minted.
            if ($existing !== null && $this->isAbandoned($existing)) {
                $this->markFailed($existing, new AiFailure(
                    AiFailureKind::Transient,
                    'abandoned',
                    'Generation was interrupted and never finished. Retry.',
                ));

                $existing = null;
            }

            if ($existing !== null) {
                return [$existing, false];
            }

            return [AiRun::create([
                'workspace_id' => $document->workspace_id,
                'document_id' => $document->id,
                'created_by' => $actor->id,
                'type' => $type,
                'status' => AiRunStatus::Pending,
                'model' => (string) config('kedge.ai.model'),
                // Nothing spent yet — 0, not null. A null cost means "we made a
                // call whose price we don't know", which is a different thing.
                'tokens' => 0,
                'cost' => 0,
            ]), true];
        });

        if ($created) {
            Log::info('ai_run.started', [
                'ai_run_id' => $run->id,
                'workspace_id' => $run->workspace_id,
                'document_id' => $run->document_id,
                'type' => $run->type->value,
                'model' => $run->model,
            ]);
        }

        return [$run, $created];
    }

    /**
     * The newest run of this type for the document, whatever its status — what
     * the panel re-attaches to on mount so an in-flight or finished run is never
     * forgotten (eng review §8).
     */
    public function latestFor(Document $document, AiRunType $type): ?AiRun
    {
        return AiRun::query()
            ->where('document_id', $document->id)
            ->where('type', $type->value)
            ->latest('id')
            ->first();
    }

    /**
     * Claim a run for execution. A retry of the same job re-claims a `running`
     * row, but a TERMINAL row is never reopened — so a redelivered job for an
     * already-failed or already-completed run does nothing at all.
     *
     * The claim's success is read back from the persisted status rather than
     * from an affected-row count, which is not portable across drivers when an
     * update writes the value a column already holds.
     */
    public function markRunning(AiRun $run): bool
    {
        AiRun::query()
            ->whereKey($run->id)
            ->whereIn('status', [AiRunStatus::Pending->value, AiRunStatus::Running->value])
            ->update(['status' => AiRunStatus::Running->value, 'updated_at' => now()]);

        $run->refresh();

        return $run->status === AiRunStatus::Running;
    }

    /**
     * Record what this run's prompt was assembled FROM, before any model call.
     *
     * Written up front on purpose: a run that later fails still says what it was
     * going to read (which version, which threads, how many chunks), so a failed
     * run is diagnosable instead of blank. Scope metadata only — never the
     * assembled prompt text, never a credential.
     *
     * @param  array<string, mixed>  $meta
     */
    public function recordScope(AiRun $run, array $meta): void
    {
        AiRun::query()
            ->whereKey($run->id)
            ->inFlight()
            ->update(['input' => json_encode($meta), 'updated_at' => now()]);

        $run->refresh();
    }

    /**
     * Add one model call's spend to the run, as soon as it is incurred.
     *
     * Accumulated per call rather than summed at the end, because money spent is
     * money spent: a chunked run whose third call fails still billed the first
     * two, and a transient retry that re-runs earlier chunks really is charged
     * twice. Recording only on success would quietly under-report AI cost/day
     * (SPEC §19) exactly when spend is highest.
     *
     * A null `$cost` means the model has no published price here, so the run's
     * total becomes permanently unknown (null) rather than silently understated.
     */
    public function recordSpend(AiRun $run, ?string $model, int $tokens, ?float $cost): void
    {
        DB::transaction(function () use ($run, $model, $tokens, $cost): void {
            $fresh = AiRun::query()->whereKey($run->id)->lockForUpdate()->first();

            if ($fresh === null || $fresh->isTerminal()) {
                return;
            }

            $fresh->forceFill([
                'tokens' => (int) ($fresh->tokens ?? 0) + $tokens,
                'cost' => $cost === null || $fresh->cost === null
                    ? null
                    : (float) $fresh->cost + $cost,
                'model' => $model ?? $fresh->model,
            ])->save();
        });

        $run->refresh();
    }

    /**
     * Land a completed run. A no-op on an already-terminal run. Spend is NOT
     * written here — it was recorded call by call as it was incurred.
     */
    public function markCompleted(AiRun $run, AiGeneration $generation): void
    {
        $landed = $this->landTerminal($run, [
            'status' => AiRunStatus::Completed->value,
            'output' => json_encode($generation->output),
        ]);

        if (! $landed) {
            return;
        }

        $coverage = $run->coverage() ?? [];

        Log::info('ai_run.completed', [
            'ai_run_id' => $run->id,
            'workspace_id' => $run->workspace_id,
            'document_id' => $run->document_id,
            'type' => $run->type->value,
            'model' => $run->model,
            'tokens' => $run->tokens,
            'cost' => $run->cost,
            'chunked' => (bool) ($coverage['chunked'] ?? false),
            'coverage' => ($coverage['covered'] ?? null).'/'.($coverage['total'] ?? null),
        ]);
    }

    /**
     * Land a failed run with its classified error. A no-op on an already-terminal
     * run: a failed run is never rewritten, and a completed one is never undone
     * by a late handler.
     */
    public function markFailed(AiRun $run, AiFailure $failure): void
    {
        $landed = $this->landTerminal($run, [
            'status' => AiRunStatus::Failed->value,
            'error' => json_encode($failure->toArray()),
        ]);

        if (! $landed) {
            return;
        }

        Log::warning('ai_run.failed', [
            'ai_run_id' => $run->id,
            'workspace_id' => $run->workspace_id,
            'document_id' => $run->document_id,
            'type' => $run->type->value,
            'model' => $run->model,
            'tokens' => $run->tokens,
            'cost' => $run->cost,
            'kind' => $failure->kind->value,
            'code' => $failure->code,
        ]);
    }

    /**
     * A run in flight for longer than any legitimate execution could take, so no
     * worker is coming back for it.
     */
    private function isAbandoned(AiRun $run): bool
    {
        $cutoff = max(1, (int) config('kedge.ai.stale_after', 1800));

        return $run->created_at !== null && $run->created_at->lt(now()->subSeconds($cutoff));
    }

    /**
     * Write a terminal state only over a non-terminal one, and refresh the model
     * so callers observe what actually landed.
     *
     * @param  array<string, mixed>  $attributes
     */
    private function landTerminal(AiRun $run, array $attributes): bool
    {
        $landed = AiRun::query()
            ->whereKey($run->id)
            ->whereIn('status', [AiRunStatus::Pending->value, AiRunStatus::Running->value])
            ->update($attributes + ['updated_at' => now()]);

        $run->refresh();

        return $landed > 0;
    }
}
