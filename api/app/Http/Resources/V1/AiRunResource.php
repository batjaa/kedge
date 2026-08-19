<?php

namespace App\Http\Resources\V1;

use App\Models\AiRun;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One AI run as the web reads it (SPEC §14, §16). The digest panel POSTs, gets
 * this back, and polls this same shape until `status` is terminal.
 *
 * `output` is the structured result including its verbatim `coverage.statement`;
 * `error` carries the classified failure so the panel can name what went wrong
 * next to the retry action. `input` — prompt metadata and scope refs — is
 * deliberately NOT serialized: it is operator/ledger detail, not client contract.
 *
 * Hand-kept in sync with web/lib/ai-types.ts.
 *
 * @mixin AiRun
 */
class AiRunResource extends JsonResource
{
    /** No `data` envelope — matches the M0/M1 house shape. */
    public static $wrap = null;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'document_id' => $this->document_id,
            'type' => $this->type->value,
            'status' => $this->status->value,
            'model' => $this->model,
            // The visible half of the ledger (SPEC §14, §16): what this run has
            // cost so far. Present on an in-flight run too — spend is recorded as
            // it is incurred, not at the end — and `cost` is null when the model
            // has no published price rather than a fabricated zero.
            'tokens' => $this->tokens,
            'cost' => $this->cost === null ? null : (float) $this->cost,
            'output' => $this->output,
            'error' => $this->error,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
