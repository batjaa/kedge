<?php

namespace App\Models;

use App\Enums\AiRunStatus;
use App\Enums\AiRunType;
use App\Services\AI\AiRunLedger;
use Database\Factories\AiRunFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * One queued AI generation with its cost ledger (SPEC §14, §16 — CONTEXT.md
 * "AI Run"). Append-only: rows are written forward through
 * {@see AiRunLedger}, which refuses to move a terminal run, so
 * a retry is always a NEW row and spend history is never rewritten.
 *
 * @property-read AiRunType $type
 * @property-read AiRunStatus $status
 */
#[Fillable(['workspace_id', 'document_id', 'created_by', 'target_type', 'target_id', 'type', 'status', 'input', 'model', 'tokens', 'cost'])]
class AiRun extends Model
{
    /** @use HasFactory<AiRunFactory> */
    use HasFactory;

    protected $attributes = [
        'status' => 'pending',
    ];

    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * What this run was asked about, when that is narrower than the document —
     * the comment a split was proposed for. Null for the document-wide runs.
     */
    public function target(): MorphTo
    {
        return $this->morphTo();
    }

    /**
     * Runs still on their way to an answer. The single definition of "in flight":
     * the server-side dedupe probe reads it, and nothing else may re-spell it.
     *
     * @param  Builder<AiRun>  $query
     * @return Builder<AiRun>
     */
    public function scopeInFlight(Builder $query): Builder
    {
        return $query->whereIn('ai_runs.status', [
            AiRunStatus::Pending->value,
            AiRunStatus::Running->value,
        ]);
    }

    public function isTerminal(): bool
    {
        return $this->status->isTerminal();
    }

    /**
     * The coverage statement the digest panel renders verbatim, when the run
     * produced one. Null for a run that has not completed.
     */
    public function coverage(): ?array
    {
        $coverage = $this->output['coverage'] ?? null;

        return is_array($coverage) ? $coverage : null;
    }

    protected function casts(): array
    {
        return [
            'type' => AiRunType::class,
            'status' => AiRunStatus::class,
            'input' => 'array',
            'output' => 'array',
            'error' => 'array',
            'tokens' => 'integer',
            'cost' => 'decimal:6',
        ];
    }
}
