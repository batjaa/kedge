<?php

namespace App\Services\AI;

use App\Enums\AiFailureKind;
use App\Enums\AiRunStatus;
use App\Enums\AiRunType;
use App\Models\AiRun;
use App\Models\Document;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
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
 *     the same (document, type, target, variant) is pending or running joins that
 *     run instead of minting one, so a double-click or a returning user can't
 *     double-bill — while a reply draft in a DIFFERENT stance, being a different
 *     question, still mints its own run rather than being handed the other
 *     stance's answer. The
 *     probe runs under a lock on the document row, so two simultaneous requests
 *     serialize rather than racing into two rows.
 */
class AiRunLedger
{
    /**
     * Mint a run, or return the in-flight one for this (document, type, target,
     * variant).
     *
     * `$target` narrows a run to one part of the document (a thread for a reply
     * draft or a summary); `$variant` distinguishes two requests that differ in
     * what was ASKED for rather than what was read — the reply-draft stance. Both
     * are null for the document-wide types, which dedupe exactly as they always
     * did.
     *
     * @return array{AiRun, bool} the run, and whether it was newly created
     */
    public function startOrJoin(
        Document $document,
        User $actor,
        AiRunType $type,
        ?Model $target = null,
        ?string $variant = null,
    ): array {
        [$run, $created] = DB::transaction(function () use ($document, $actor, $type, $target, $variant): array {
            // Serialize concurrent requests for this document. Without it the
            // probe below is a check-then-act race and a double-click bills twice.
            Document::query()->whereKey($document->id)->lockForUpdate()->first();

            $existing = $this->scopedTo(
                AiRun::query()->where('document_id', $document->id)->where('type', $type->value),
                $target,
                $variant,
            )
                // A per-actor run is never joined across people: a reply draft is
                // written in the requester's voice, for a position they picked
                // and have not said out loud yet.
                ->when($type->isPerActor(), fn (Builder $q): Builder => $q->where('created_by', $actor->id))
                ->inFlight()
                ->latest('id')
                ->first();

            // Stale-run takeover (the M3.6 scan idiom). A worker killed hard
            // enough never runs its terminal handler, so without this the dead
            // row would be joined by every later request forever and the author
            // could never get a digest again. Past the cutoff it is failed —
            // honestly, as an abandoned run keeping whatever it already spent —
            // and a replacement is minted.
            //
            // The kill is conditional, and we HONOUR ITS RESULT: if it lands on
            // nothing, the run reached a terminal state between the probe above
            // and this write, and re-reading is the only truthful next move —
            // declaring it dead and billing a replacement would throw away a
            // digest the author already paid for.
            if ($existing !== null && $this->isAbandoned($existing)) {
                $killed = $this->markFailed($existing, new AiFailure(
                    AiFailureKind::Transient,
                    'abandoned',
                    'Generation was interrupted and never finished. Retry.',
                ));

                if (! $killed) {
                    $existing->refresh();
                }
            }

            // Anything but a failed run is worth handing back: still in flight
            // (the dedupe case), or completed under us during a takeover. A
            // failed run — ours or its own — falls through to a replacement,
            // which is what "retry mints a new run" means.
            if ($existing !== null && $existing->status !== AiRunStatus::Failed) {
                return [$existing, false];
            }

            $run = new AiRun([
                'workspace_id' => $document->workspace_id,
                'document_id' => $document->id,
                'created_by' => $actor->id,
                'type' => $type,
                'variant' => $variant,
                'status' => AiRunStatus::Pending,
                // One rule for which model a type bills against, shared with the
                // agent that will make the call — so the row and the request can
                // never name different models (SPEC §14).
                'model' => $type->model(),
                // Nothing spent yet — 0, not null. A null cost means "we made a
                // call whose price we don't know", which is a different thing.
                'tokens' => 0,
                'cost' => 0,
            ]);

            if ($target !== null) {
                $run->target()->associate($target);
            }

            $run->save();

            return [$run, true];
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
    public function latestFor(
        Document $document,
        AiRunType $type,
        ?Model $target = null,
        ?string $variant = null,
    ): ?AiRun {
        return $this->scopedTo(
            AiRun::query()->where('document_id', $document->id)->where('type', $type->value),
            $target,
            $variant,
        )
            ->latest('id')
            ->first();
    }

    /**
     * Narrow a run query to one target and variant — the single spelling of
     * "the same request", shared by the dedupe probe and the re-attach read so
     * the two can never drift apart and strand a run.
     *
     * A null target or variant means IS NULL, not "any": a document-wide digest
     * must never join a thread's summary just because both belong to the
     * document.
     *
     * @param  Builder<AiRun>  $query
     * @return Builder<AiRun>
     */
    private function scopedTo(Builder $query, ?Model $target, ?string $variant): Builder
    {
        return $query
            ->when(
                $target === null,
                fn (Builder $q): Builder => $q->whereNull('target_type')->whereNull('target_id'),
                fn (Builder $q): Builder => $q
                    ->where('target_type', $target->getMorphClass())
                    ->where('target_id', $target->getKey()),
            )
            ->when(
                $variant === null,
                fn (Builder $q): Builder => $q->whereNull('variant'),
                fn (Builder $q): Builder => $q->where('variant', $variant),
            );
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
        DB::transaction(function () use ($run, $meta): void {
            $fresh = AiRun::query()->whereKey($run->id)->lockForUpdate()->first();

            if ($fresh === null || $fresh->isTerminal()) {
                return;
            }

            // The FIRST assembly is the run's declared scope, and it is frozen
            // there. A transient retry re-reads live data, so overwriting would
            // leave the terminal row describing only the last attempt while its
            // accumulated spend covers them all — a row that quietly disagrees
            // with itself. The attempt count is kept instead, so the retries are
            // visible rather than the scope being rewritten to hide them.
            $input = $fresh->input ?? $meta;
            $input['attempts'] = (int) ($fresh->input['attempts'] ?? 0) + 1;

            $fresh->forceFill(['input' => $input])->save();
        });

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
     * Mark the run's cost UNKNOWN — a model call was issued but died before it
     * could report what it used.
     *
     * The provider may well have accepted and billed that request, so sealing the
     * row at its last known figure would state a number we know to be too low.
     * Null is the honest answer: "something was spent here, and we cannot say how
     * much." Tokens keep whatever earlier calls did report.
     */
    public function markSpendUnknown(AiRun $run): void
    {
        AiRun::query()
            ->whereKey($run->id)
            ->inFlight()
            ->update(['cost' => null, 'updated_at' => now()]);

        $run->refresh();
    }

    /**
     * Land a completed run. A no-op on an already-terminal run. Spend is NOT
     * written here — it was recorded call by call as it was incurred.
     */
    public function markCompleted(AiRun $run, AiGeneration $generation): bool
    {
        $landed = $this->landTerminal($run, [
            'status' => AiRunStatus::Completed->value,
            'output' => json_encode($generation->output),
        ]);

        if (! $landed) {
            return false;
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

        return true;
    }

    /**
     * Land a failed run with its classified error. A no-op on an already-terminal
     * run: a failed run is never rewritten, and a completed one is never undone
     * by a late handler.
     *
     * Returns whether THIS call is the one that landed it, so a caller racing
     * another writer (stale takeover vs. a live worker) can tell the difference
     * between "I killed it" and "someone else finished it first".
     */
    public function markFailed(AiRun $run, AiFailure $failure): bool
    {
        $landed = $this->landTerminal($run, [
            'status' => AiRunStatus::Failed->value,
            'error' => json_encode($failure->toArray()),
        ]);

        if (! $landed) {
            return false;
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

        return true;
    }

    /**
     * A run that has shown no sign of life for longer than any legitimate
     * execution could take, so no worker is coming back for it.
     *
     * Measured from `updated_at`, NOT `created_at`: every step a live run takes —
     * claiming it, recording its scope, banking each call's spend — stamps that
     * column, so an actively generating run keeps renewing its own lease. Judging
     * by creation time instead would kill a run that merely waited a long while
     * in a backed-up queue before starting, discarding the spend it was in the
     * middle of incurring and billing a replacement for the same work.
     */
    private function isAbandoned(AiRun $run): bool
    {
        $cutoff = max(1, (int) config('kedge.ai.stale_after', 1800));
        $lastSign = $run->updated_at ?? $run->created_at;

        return $lastSign !== null && $lastSign->lt(now()->subSeconds($cutoff));
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
