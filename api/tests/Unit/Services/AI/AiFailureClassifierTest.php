<?php

namespace Tests\Unit\Services\AI;

use App\Enums\AiFailureKind;
use App\Services\AI\AiFailureClassifier;
use App\Services\AI\Exceptions\ContentRefusedException;
use App\Services\AI\Exceptions\UnparseableOutputException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Client\Response;
use Illuminate\Queue\MaxAttemptsExceededException;
use Illuminate\Queue\TimeoutExceededException;
use Laravel\Ai\Exceptions\InsufficientCreditsException;
use Laravel\Ai\Exceptions\ProviderOverloadedException;
use Laravel\Ai\Exceptions\RateLimitedException;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

/**
 * The deterministic/transient split (m4 eng review §5). One table: exception →
 * kind + code. Getting a case wrong here means either a retry loop that bills a
 * key for the same rejection three times, or a blip surfaced as a hard failure.
 */
class AiFailureClassifierTest extends TestCase
{
    /**
     * @return array<string, array{\Throwable, AiFailureKind, string}>
     */
    public static function failures(): array
    {
        return [
            'provider overloaded' => [
                ProviderOverloadedException::forProvider('anthropic'), AiFailureKind::Transient, 'provider_overloaded',
            ],
            'rate limited' => [
                RateLimitedException::forProvider('anthropic'), AiFailureKind::Transient, 'rate_limited',
            ],
            'connection failure' => [
                new ConnectionException('timed out'), AiFailureKind::Transient, 'provider_unreachable',
            ],

            // #153: cURL calls all of these "connection errors", but only one of
            // them means the provider was reached, was working, and was billed.
            'name resolution failed' => [
                new ConnectionException('cURL error 6: Could not resolve host: api.example.test'),
                AiFailureKind::Transient,
                'provider_unreachable',
            ],
            'connection refused' => [
                new ConnectionException('cURL error 7: Failed to connect to api.example.test port 443: Connection refused'),
                AiFailureKind::Transient,
                'provider_unreachable',
            ],
            'connect phase timed out' => [
                new ConnectionException('cURL error 28: Connection timed out after 10001 milliseconds'),
                AiFailureKind::Transient,
                'provider_unreachable',
            ],
            'tls handshake failed' => [
                new ConnectionException('cURL error 35: SSL connect error'),
                AiFailureKind::Transient,
                'provider_unreachable',
            ],
            'generation outran our clock' => [
                new ConnectionException('cURL error 28: Operation timed out after 270003 milliseconds with 0 bytes received'),
                AiFailureKind::Deterministic,
                'generation_timeout',
            ],
            'job timeout' => [
                new TimeoutExceededException('timed out'), AiFailureKind::Transient, 'job_timeout',
            ],
            'attempts exhausted' => [
                new MaxAttemptsExceededException('gone'), AiFailureKind::Transient, 'retries_exhausted',
            ],
            'unparseable output' => [
                new UnparseableOutputException('bad shape'), AiFailureKind::Deterministic, 'unparseable_output',
            ],
            'content refused' => [
                new ContentRefusedException('refused'), AiFailureKind::Deterministic, 'content_refused',
            ],
            'out of credit' => [
                InsufficientCreditsException::forProvider('anthropic'), AiFailureKind::Deterministic, 'insufficient_credits',
            ],
            // A provider selected in AI_PROVIDER that cannot generate text: the
            // SDK refuses to build it, and no retry will change its mind.
            'provider cannot generate text' => [
                new \LogicException('Provider [Cohere] does not support text generation.'),
                AiFailureKind::Deterministic,
                'provider_unsupported',
            ],
            'unknown fault' => [
                new RuntimeException('what'), AiFailureKind::Deterministic, 'unknown',
            ],
        ];
    }

    #[DataProvider('failures')]
    public function test_it_classifies_failures(\Throwable $e, AiFailureKind $kind, string $code): void
    {
        $failure = app(AiFailureClassifier::class)->classify($e);

        $this->assertSame($kind, $failure->kind);
        $this->assertSame($code, $failure->code);
        $this->assertNotSame('', $failure->message);
    }

    /**
     * @return array<string, array{int, AiFailureKind, string}>
     */
    public static function statuses(): array
    {
        return [
            'unauthorized key' => [401, AiFailureKind::Deterministic, 'invalid_key'],
            'forbidden key' => [403, AiFailureKind::Deterministic, 'invalid_key'],
            'bad request' => [400, AiFailureKind::Deterministic, 'provider_rejected'],
            'too many requests' => [429, AiFailureKind::Transient, 'rate_limited'],
            'provider error' => [500, AiFailureKind::Transient, 'provider_unavailable'],
            'gateway timeout' => [504, AiFailureKind::Transient, 'provider_unavailable'],
        ];
    }

    #[DataProvider('statuses')]
    public function test_it_classifies_provider_http_statuses(int $status, AiFailureKind $kind, string $code): void
    {
        $failure = app(AiFailureClassifier::class)->classify($this->requestException($status));

        $this->assertSame($kind, $failure->kind);
        $this->assertSame($code, $failure->code);
    }

    public function test_a_policy_rejection_is_named_a_refusal_not_a_generic_reject(): void
    {
        $failure = app(AiFailureClassifier::class)->classify(
            $this->requestException(400, 'Output blocked by content policy filtering.'),
        );

        $this->assertSame(AiFailureKind::Deterministic, $failure->kind);
        $this->assertSame('content_refused', $failure->code);
    }

    /**
     * The #153 decision, stated as behavior: a retry after our own transfer
     * clock expires re-bills a prompt the provider already accepted, so the
     * reader gets an action instead of an automatic second billing.
     */
    public function test_a_generation_that_outran_our_clock_is_never_retried(): void
    {
        $failure = app(AiFailureClassifier::class)->classify(new ConnectionException(
            'cURL error 28: Operation timed out after 270003 milliseconds with 0 bytes received',
        ));

        $this->assertFalse($failure->isTransient());
        $this->assertSame('generation_timeout', $failure->code);

        // The sentence has to be actionable — "retry" is what got us here.
        $this->assertStringNotContainsStringIgnoringCase('retry', $failure->message);
        $this->assertStringContainsStringIgnoringCase('shorter', $failure->message);
    }

    /**
     * The other half of the same decision: a provider we never reached is still
     * a blip worth backing off for, and nothing was billed.
     */
    public function test_a_provider_that_was_never_reached_is_still_transient(): void
    {
        foreach ([
            'cURL error 6: Could not resolve host: api.example.test',
            'cURL error 7: Failed to connect to api.example.test port 443: Connection refused',
            'cURL error 28: Connection timed out after 10001 milliseconds',
        ] as $message) {
            $failure = app(AiFailureClassifier::class)->classify(new ConnectionException($message));

            $this->assertTrue($failure->isTransient(), $message.' should still retry');
            $this->assertSame('provider_unreachable', $failure->code);
        }
    }

    public function test_a_missing_exception_is_still_classified(): void
    {
        $failure = app(AiFailureClassifier::class)->classify(null);

        $this->assertSame(AiFailureKind::Deterministic, $failure->kind);
        $this->assertSame('unknown', $failure->code);
    }

    private function requestException(int $status, string $message = 'nope'): RequestException
    {
        return new RequestException(new Response(
            new \GuzzleHttp\Psr7\Response($status, [], json_encode(['error' => ['message' => $message]])),
        ));
    }
}
