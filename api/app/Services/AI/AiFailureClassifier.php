<?php

namespace App\Services\AI;

use App\Enums\AiFailureKind;
use App\Services\AI\Exceptions\AiGenerationException;
use App\Services\AI\Exceptions\ContentRefusedException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Queue\MaxAttemptsExceededException;
use Illuminate\Queue\TimeoutExceededException;
use Laravel\Ai\Exceptions\InsufficientCreditsException;
use Laravel\Ai\Exceptions\ProviderOverloadedException;
use Laravel\Ai\Exceptions\RateLimitedException;
use LogicException;
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
 *
 * Both the classification and the sentences it hands the reader are
 * PROVIDER-NEUTRAL (#140): the SDK's exception types and HTTP statuses mean the
 * same thing whichever provider is selected, and an operator running a local
 * model should not be told Claude is overloaded. The stable `code` — what the
 * ledger stores and the tests assert — never mentions a provider either.
 */
class AiFailureClassifier
{
    public function classify(?Throwable $e): AiFailure
    {
        return match (true) {
            // Failures Kedge raises are deterministic by construction; each
            // carries its own code and user sentence.
            $e instanceof AiGenerationException => $e->asFailure(),

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
                'The AI provider is overloaded right now. Retry.',
            ),
            $e instanceof RateLimitedException => new AiFailure(
                AiFailureKind::Transient,
                'rate_limited',
                'The AI provider is rate-limiting this key. Retry in a moment.',
            ),
            $e instanceof ConnectionException => new AiFailure(
                AiFailureKind::Transient,
                'provider_unreachable',
                'Could not reach the AI provider. Retry.',
            ),

            // Quota is gone, not busy — a retry inside the backoff window buys
            // nothing and bills nothing back.
            $e instanceof InsufficientCreditsException => new AiFailure(
                AiFailureKind::Deterministic,
                'insufficient_credits',
                'The configured AI provider key is out of credit.',
            ),

            $e instanceof RequestException => $this->fromStatus($e),

            // A misconfigured selection, not a fault: the SDK refuses to build a
            // text provider for one that cannot generate text (an embeddings- or
            // audio-only provider named in AI_PROVIDER). The gate can only see
            // that a credential exists, so this is where the operator finds out
            // — with the variable to fix named, rather than "retry" advice for
            // something no retry can change.
            $e instanceof LogicException => new AiFailure(
                AiFailureKind::Deterministic,
                'provider_unsupported',
                'The configured AI provider cannot generate text. Ask an operator to check AI_PROVIDER.',
            ),

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
                'The configured AI provider key was rejected. Ask an operator to check it.',
            );
        }

        if ($status === 429) {
            return new AiFailure(
                AiFailureKind::Transient,
                'rate_limited',
                'The AI provider is rate-limiting this key. Retry in a moment.',
            );
        }

        if ($status >= 500) {
            return new AiFailure(
                AiFailureKind::Transient,
                'provider_unavailable',
                'The AI provider is unavailable right now. Retry.',
            );
        }

        // A content-policy rejection deserves its own error: "retry" is useless
        // advice, whereas "edit the review" is actionable.
        if ($this->readsAsRefusal($e)) {
            return (new ContentRefusedException('The provider refused this content.'))->asFailure();
        }

        return new AiFailure(
            AiFailureKind::Deterministic,
            'provider_rejected',
            'The AI provider rejected the request. Retry.',
        );
    }

    private function readsAsRefusal(RequestException $e): bool
    {
        $message = strtolower((string) ($e->response?->json('error.message') ?? ''));

        foreach (['content policy', 'policy violation', 'refus', 'safety', 'prohibited'] as $needle) {
            if (str_contains($message, $needle)) {
                return true;
            }
        }

        return false;
    }
}
