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

    public function test_a_missing_exception_is_still_classified(): void
    {
        $failure = app(AiFailureClassifier::class)->classify(null);

        $this->assertSame(AiFailureKind::Deterministic, $failure->kind);
        $this->assertSame('unknown', $failure->code);
    }

    private function requestException(int $status): RequestException
    {
        return new RequestException(new Response(
            new \GuzzleHttp\Psr7\Response($status, [], '{"error":{"message":"nope"}}'),
        ));
    }
}
