<?php

namespace App\Services\AI;

use App\Models\AiRun;
use App\Services\AI\Exceptions\ContentRefusedException;
use App\Services\AI\Exceptions\UnparseableOutputException;
use Closure;
use Laravel\Ai\Responses\Data\FinishReason;
use Laravel\Ai\Responses\StructuredAgentResponse;
use Laravel\Ai\Responses\TextResponse;

/**
 * One structured model call, with the three things every generator must do
 * around it and must not get wrong:
 *
 *  1. **Bill first, judge second.** Spend is written to the ledger the moment the
 *     response lands — before the shape is inspected — because a refusal or an
 *     unusable payload was still charged. Recording only on success would
 *     under-report AI cost/day (SPEC §19) exactly when spend is being wasted.
 *  2. **A content-policy refusal is DETERMINISTIC.** The same material will be
 *     refused again, so the run fails at once instead of retrying into the same
 *     wall (the m4 deterministic/transient split, eng review §5).
 *  3. **Unstructured output is DETERMINISTIC too.** The SDK has already parsed
 *     and retried by the time we see it; a shape we can't render will not become
 *     renderable on a fourth attempt.
 *
 * Extracted so each new run type is a builder plus an output shape, and cannot
 * quietly ship a fourth copy of the billing rule with the ordering reversed.
 */
class StructuredCall
{
    public function __construct(
        private readonly AiCostCalculator $costs,
        private readonly AiRunLedger $ledger,
    ) {}

    /**
     * @param  Closure(): TextResponse  $call
     * @return array<string, mixed> the structured payload
     */
    public function invoke(AiRun $run, Closure $call): array
    {
        $response = $call();

        $model = $response->meta->model;
        $this->ledger->recordSpend(
            $run,
            $model,
            $this->costs->totalTokens($response->usage),
            $this->costs->cost($model, $response->usage),
        );

        if ($response->steps->last()?->finishReason === FinishReason::ContentFilter) {
            throw new ContentRefusedException('The provider refused this content.');
        }

        if (! $response instanceof StructuredAgentResponse) {
            throw new UnparseableOutputException('The model returned unstructured output.');
        }

        return $response->toArray();
    }

    /**
     * Read one required string field out of a structured payload, or fail the run
     * deterministically. Whitespace-only counts as missing: an empty draft or an
     * empty summary is not an answer, and rendering one would be a lie dressed as
     * a success.
     *
     * @param  array<string, mixed>  $structured
     */
    public function requiredText(array $structured, string $field): string
    {
        $value = $structured[$field] ?? null;

        if (! is_string($value) || trim($value) === '') {
            throw new UnparseableOutputException('The model omitted the ['.$field.'] field.');
        }

        return trim($value);
    }
}
