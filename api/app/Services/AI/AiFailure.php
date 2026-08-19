<?php

namespace App\Services\AI;

use App\Enums\AiFailureKind;

/**
 * A classified generation failure: what went wrong, whether retrying could ever
 * help, and the sentence the author reads next to the retry action.
 *
 * Persisted whole into `ai_runs.error` and emitted on `ai_run.failed`, so the
 * alertable split (transient spike = provider trouble) is queryable from both
 * the ledger and the logs.
 */
final class AiFailure
{
    public function __construct(
        public readonly AiFailureKind $kind,
        public readonly string $code,
        public readonly string $message,
    ) {}

    public function isTransient(): bool
    {
        return $this->kind === AiFailureKind::Transient;
    }

    /**
     * @return array<string, string>
     */
    public function toArray(): array
    {
        return [
            'kind' => $this->kind->value,
            'code' => $this->code,
            'message' => $this->message,
        ];
    }
}
