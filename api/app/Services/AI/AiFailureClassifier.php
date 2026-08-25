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
            $e instanceof ConnectionException => $this->fromConnectionFailure($e),

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

    /**
     * One exception type, two genuinely different faults (#153).
     *
     * Laravel raises `ConnectionException` for everything cURL calls a
     * connection error, and cURL 28 sits in that list — so a generation that
     * simply outran OUR OWN clock arrived wearing the same coat as a refused
     * connection. Read as "unreachable" it was transient, so the queue backed
     * off and re-sent a ~32k-token prompt into the identical wall: run 5 on the
     * preview spent 2m51s and three billings failing that way.
     *
     * They are split here because the right answer differs in both directions:
     *
     *  - NOT REACHED (DNS, refused, connect-phase timeout, TLS): the provider
     *    never saw the request, nothing was billed, and a blip clears. Transient
     *    — unchanged.
     *  - REACHED, TOO SLOW: the provider was working. The request is already
     *    billed server-side and may well complete there after we hang up, so a
     *    retry can bill the same prompt twice for one answer nobody sees. It is
     *    also unlikely to help: the clock is now the job's whole budget minus
     *    the margin (`AiRunBudget::http()`), and a backoff of seconds does not
     *    make the next generation shorter. Genuine provider slowness has its own
     *    honest codes — overloaded, 5xx, rate-limited — which stay transient.
     *
     * So the slow case is DETERMINISTIC, matching the classifier's cost-safe
     * house rule, and it says the one thing that actually helps. It also keeps
     * faith with its sibling: the job's own timeout 30 seconds later is terminal
     * too, so the two nearly-identical conditions no longer behave in opposite
     * ways depending on which clock happened to win.
     */
    private function fromConnectionFailure(ConnectionException $e): AiFailure
    {
        if ($this->readsAsGenerationTimeout($e)) {
            return new AiFailure(
                AiFailureKind::Deterministic,
                'generation_timeout',
                'The answer took too long to generate. Try a shorter question, or a smaller selection.',
            );
        }

        return new AiFailure(
            AiFailureKind::Transient,
            'provider_unreachable',
            'Could not reach the AI provider. Retry.',
        );
    }

    /**
     * Whether a connection failure is our transfer clock expiring rather than a
     * provider we never reached.
     *
     * cURL 28 covers BOTH of its clocks, and the wording is what tells them
     * apart: the connect phase says "Connection timed out after N milliseconds",
     * while the transfer clock — the one an agent's timeout sets — says
     * "Operation timed out after N milliseconds with 0 bytes received". Only the
     * second means the provider answered our SYN and then thought for too long,
     * and the byte count is the half that says so: it is reported by a transfer
     * that was under way.
     *
     * BOTH halves are required, deliberately. A proxy or a non-cURL transport
     * that says only "Operation timed out" has not told us it ever reached the
     * provider, and everything this does not positively recognize keeps the old
     * transient reading — an unfamiliar driver should cost a retry, not a
     * wrongly-terminal run.
     */
    private function readsAsGenerationTimeout(ConnectionException $e): bool
    {
        $message = strtolower($e->getMessage());

        return str_contains($message, 'operation timed out')
            && str_contains($message, 'bytes received');
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
