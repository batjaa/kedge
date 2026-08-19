<?php

namespace App\Services\AI;

use App\Enums\AiFailureKind;
use App\Services\AI\Exceptions\AiGenerationException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Queue\MaxAttemptsExceededException;
use Illuminate\Queue\TimeoutExceededException;
use Laravel\Ai\Exceptions\InsufficientCreditsException;
use Laravel\Ai\Exceptions\ProviderOverloadedException;
use Laravel\Ai\Exceptions\RateLimitedException;
use Throwable;

/**
 * The M1 deterministic/transient split applied to AI generation (m4 eng review
 * §5). One place decides, so the job never has to guess and the two behaviours
 * stay honestly different:
 *
 *   transient     → retry with backoff, then land `failed`
 *   deterministic → land `failed` immediately, no retries
 *
 * Anything unrecognized is treated as DETERMINISTIC. That is the deliberate,
 * cost-safe default: an unknown fault is far more likely to be our bug than a
 * blip, and retrying it three times only bills the key three times for the same
 * answer.
 */
class AiFailureClassifier
{
    public function classify(?Throwable $e): AiFailure
    {
        return match (true) {
            // Failures Kedge raises are deterministic by construction; each
            // carries its own code and user sentence.
            $e instanceof AiGenerationException => new AiFailure(
                AiFailureKind::Deterministic,
                $e->code(),
                $e->userMessage(),
            ),

            // The queue's own ceilings. A job timeout is terminal by design (the
            // run must never sit `running` forever); exhausted attempts mean a
            // transient fault never cleared.
            $e instanceof TimeoutExceededException => new AiFailure(
                AiFailureKind::Transient,
                'job_timeout',
                'Generation took too long and was stopped. Retry.',
            ),
            $e instanceof MaxAttemptsExceededException => new AiFailure(
                AiFailureKind::Transient,
                'retries_exhausted',
                'Generation failed after several attempts. Retry.',
            ),

            $e instanceof ProviderOverloadedException => new AiFailure(
                AiFailureKind::Transient,
                'provider_overloaded',
                'Claude is overloaded right now. Retry.',
            ),
            $e instanceof RateLimitedException => new AiFailure(
                AiFailureKind::Transient,
                'rate_limited',
                'Claude is rate-limiting this key. Retry in a moment.',
            ),
            $e instanceof ConnectionException => new AiFailure(
                AiFailureKind::Transient,
                'provider_unreachable',
                'Could not reach Claude. Retry.',
            ),

            // Quota is gone, not busy — a retry inside the backoff window buys
            // nothing and bills nothing back.
            $e instanceof InsufficientCreditsException => new AiFailure(
                AiFailureKind::Deterministic,
                'insufficient_credits',
                'The configured Anthropic key is out of credit.',
            ),

            $e instanceof RequestException => $this->fromStatus($e),

            default => new AiFailure(
                AiFailureKind::Deterministic,
                'unknown',
                'Generation failed. Retry.',
            ),
        };
    }

    private function fromStatus(RequestException $e): AiFailure
    {
        $status = $e->response?->status() ?? 0;

        // A bad, revoked, or absent key is the operator's problem, not a blip.
        if ($status === 401 || $status === 403) {
            return new AiFailure(
                AiFailureKind::Deterministic,
                'invalid_key',
                'The configured Anthropic key was rejected. Ask an operator to check it.',
            );
        }

        if ($status === 429) {
            return new AiFailure(
                AiFailureKind::Transient,
                'rate_limited',
                'Claude is rate-limiting this key. Retry in a moment.',
            );
        }

        if ($status >= 500) {
            return new AiFailure(
                AiFailureKind::Transient,
                'provider_unavailable',
                'Claude is unavailable right now. Retry.',
            );
        }

        return new AiFailure(
            AiFailureKind::Deterministic,
            'provider_rejected',
            'Claude rejected the request. Retry.',
        );
    }
}
