<?php

namespace Tests\Feature\Ai;

use App\Enums\AiRunStatus;
use App\Jobs\GenerateAiRunJob;
use App\Models\AiRun;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\User;
use App\Services\AI\Agents\CommentSplitAgent;
use App\Services\AI\Agents\ImprovePromptAgent;
use App\Services\AI\Agents\ReplyDraftAgent;
use App\Services\AI\Agents\ReviewDigestAgent;
use App\Services\AI\Agents\ThreadSummaryAgent;
use App\Services\AI\AiFailureClassifier;
use App\Services\AI\AiGeneratorRegistry;
use App\Services\AI\AiRunLedger;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The BYO-key gate, now that the provider is an operator choice (#140).
 *
 * The gate is the AI-spend boundary: it decides whether an instance offers
 * generation at all, and every AI route, the capability payload, and the
 * worker's pre-spend re-check read the one boolean it produces. So the rules are
 * asserted against the REAL expression in config/kedge.php — re-evaluated under a
 * substituted environment, exactly as {@see FakeAiGateTest} does for the E2E fake
 * — rather than against an overridden value, which would leave the claim
 * untested.
 *
 * Three invariants, and every case below is one of them:
 *
 *  1. **A credential is the only thing that turns AI on.** Not the kill switch,
 *     not the E2E fake, not a provider that ships a working default URL.
 *  2. **The credential must belong to the SELECTED provider.** Pointing Kedge at
 *     a provider whose key is absent hides the surface — it must never enable
 *     itself off some other provider's key, which is the coupling that made the
 *     original Anthropic-only pin the safe shape.
 *  3. **The kill switch can only force OFF.** `AI_ENABLED` never enables.
 */
class AiProviderGateTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Nothing in this file may reach a provider — the gate's whole job is
        // that nothing does.
        Http::preventStrayRequests();
    }

    /**
     * Every credential the matrix touches, cleared before each case so the run is
     * hermetic: a developer with real keys in `.env` must get the same result CI
     * does, and a case that expects "no credential anywhere" must mean it.
     */
    private const CREDENTIALS = [
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'OPENAI_COMPATIBLE_API_KEY',
        'OPENAI_COMPATIBLE_URL',
        'OLLAMA_API_KEY',
        'OLLAMA_URL',
        'GROQ_API_KEY',
        'MISTRAL_API_KEY',
        'GEMINI_API_KEY',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_BEARER_TOKEN_BEDROCK',
    ];

    /** The knobs that select and switch, cleared alongside the credentials. */
    private const SWITCHES = ['AI_PROVIDER', 'AI_ENABLED', 'AI_FAKE_RESPONSES', 'APP_ENV'];

    /**
     * @return array<string, array{array<string, string>, bool}>
     */
    public static function gateMatrix(): array
    {
        return [
            // The certified path.
            'the default provider with its key is on' => [
                ['ANTHROPIC_API_KEY' => 'sk-ant-test'], true,
            ],
            'the default provider with no key is off' => [
                [], false,
            ],

            // Invariant 2 — the gate follows the SELECTION.
            'a selected provider with its own key is on' => [
                ['AI_PROVIDER' => 'openai', 'OPENAI_API_KEY' => 'sk-oai-test'], true,
            ],
            'a selected provider cannot enable off another provider key' => [
                ['AI_PROVIDER' => 'openai', 'ANTHROPIC_API_KEY' => 'sk-ant-test'], false,
            ],
            'the default provider cannot enable off another provider key' => [
                ['AI_PROVIDER' => 'anthropic', 'OPENAI_API_KEY' => 'sk-oai-test'], false,
            ],
            'an unknown provider name is off however many keys exist' => [
                [
                    'AI_PROVIDER' => 'claude',   // the brand, not the SDK's provider id
                    'ANTHROPIC_API_KEY' => 'sk-ant-test',
                    'OPENAI_API_KEY' => 'sk-oai-test',
                ], false,
            ],

            // A local model is a first-class option — and still needs saying so.
            'a local provider with no credential is off' => [
                ['AI_PROVIDER' => 'ollama'], false,
            ],
            'a local provider with a URL but no credential is off' => [
                ['AI_PROVIDER' => 'ollama', 'OLLAMA_URL' => 'http://127.0.0.1:11434'], false,
            ],
            'a local provider is on once its key is set' => [
                ['AI_PROVIDER' => 'ollama', 'OLLAMA_API_KEY' => 'local'], true,
            ],
            'an openai-compatible endpoint alone is not a credential' => [
                ['AI_PROVIDER' => 'openai-compatible', 'OPENAI_COMPATIBLE_URL' => 'http://127.0.0.1:8080/v1'], false,
            ],
            'an openai-compatible endpoint with a key is on' => [
                [
                    'AI_PROVIDER' => 'openai-compatible',
                    'OPENAI_COMPATIBLE_URL' => 'http://127.0.0.1:8080/v1',
                    'OPENAI_COMPATIBLE_API_KEY' => 'local-key',
                ], true,
            ],

            // A provider whose credential is not called `key`.
            'a provider credentialed by access keys is on' => [
                ['AI_PROVIDER' => 'bedrock', 'AWS_ACCESS_KEY_ID' => 'AKIAEXAMPLE'], true,
            ],
            'that provider is off with no access keys at all' => [
                ['AI_PROVIDER' => 'bedrock'], false,
            ],

            // Selection is forgiving about how it is typed, and blank means default.
            'a blank selection falls back to the default provider' => [
                ['AI_PROVIDER' => '', 'ANTHROPIC_API_KEY' => 'sk-ant-test'], true,
            ],
            'selection is trimmed and case-insensitive' => [
                ['AI_PROVIDER' => '  OpenAI  ', 'OPENAI_API_KEY' => 'sk-oai-test'], true,
            ],

            // Invariant 3 — the kill switch.
            'the kill switch forces the default provider off' => [
                ['AI_ENABLED' => 'false', 'ANTHROPIC_API_KEY' => 'sk-ant-test'], false,
            ],
            'the kill switch forces a selected provider off too' => [
                ['AI_ENABLED' => '0', 'AI_PROVIDER' => 'openai', 'OPENAI_API_KEY' => 'sk-oai-test'], false,
            ],
            'the kill switch cannot force AI on' => [
                ['AI_ENABLED' => 'true'], false,
            ],
            'the kill switch cannot force a keyless provider on' => [
                ['AI_ENABLED' => 'true', 'AI_PROVIDER' => 'ollama'], false,
            ],
            'an explicit true alongside a key is simply the key' => [
                ['AI_ENABLED' => 'true', 'ANTHROPIC_API_KEY' => 'sk-ant-test'], true,
            ],

            // Invariant 1 — nothing else opens the gate. The scripted E2E fake
            // answers without a provider, but it is not a credential: the e2e
            // environment sets an obviously-fake KEY for exactly this reason.
            'the E2E fake is not a credential' => [
                ['APP_ENV' => 'e2e', 'AI_FAKE_RESPONSES' => 'true'], false,
            ],
        ];
    }

    /**
     * @param  array<string, string>  $environment
     */
    #[DataProvider('gateMatrix')]
    public function test_the_gate_follows_the_selected_providers_credential(array $environment, bool $expected): void
    {
        $this->assertSame(
            $expected,
            $this->configUnder($environment)['ai']['enabled'],
            'AI must be '.($expected ? 'ENABLED' : 'DISABLED').' under '.json_encode($environment),
        );
    }

    /**
     * The selection the agents read is the normalized one — so the provider the
     * gate checked a credential for and the provider the SDK is asked to call
     * cannot be two different providers.
     */
    public function test_the_selected_provider_is_normalized_once_for_everyone(): void
    {
        $this->assertSame('anthropic', $this->configUnder([])['ai']['provider']);
        $this->assertSame('openai', $this->configUnder(['AI_PROVIDER' => '  OpenAI  '])['ai']['provider']);
        $this->assertSame('anthropic', $this->configUnder(['AI_PROVIDER' => ''])['ai']['provider']);

        // An unknown name is kept verbatim rather than silently rewritten to the
        // default: the gate refuses it, and an operator debugging a hidden AI
        // surface should see the name they actually typed.
        $this->assertSame('claude', $this->configUnder(['AI_PROVIDER' => 'Claude'])['ai']['provider']);
    }

    /**
     * The AC that keeps the layer provider-agnostic: every agent asks the same
     * config knob, so switching providers is one env var and no code change.
     */
    public function test_every_agent_reads_the_one_provider_knob(): void
    {
        foreach (['anthropic', 'openai', 'ollama'] as $provider) {
            config(['kedge.ai.provider' => $provider]);

            foreach ([
                ReviewDigestAgent::class,
                ImprovePromptAgent::class,
                ReplyDraftAgent::class,
                ThreadSummaryAgent::class,
                CommentSplitAgent::class,
            ] as $agent) {
                $this->assertSame(
                    $provider,
                    (new $agent)->provider(),
                    $agent.' must follow the configured provider, not name one of its own.',
                );
            }
        }
    }

    /**
     * What the derived boolean actually costs an operator who points the
     * instance at a provider it has no key for: the capability goes false, the
     * routes go 404, and the run already sitting in the queue refuses to spend.
     *
     * The two config values come from the REAL expression under two real
     * environments, so this is the gate's own arithmetic driving the surface,
     * not a hand-set flag.
     */
    public function test_switching_to_an_uncredentialed_provider_withdraws_the_whole_surface(): void
    {
        $configured = $this->configUnder(['ANTHROPIC_API_KEY' => 'sk-ant-test'])['ai']['enabled'];
        $switched = $this->configUnder([
            'AI_PROVIDER' => 'openai',
            'ANTHROPIC_API_KEY' => 'sk-ant-test',
        ])['ai']['enabled'];

        $this->assertTrue($configured);
        $this->assertFalse($switched);

        [$author, $document] = $this->reviewedDocument();

        // As the instance was: the surface exists, and a digest is queued.
        config(['kedge.ai.enabled' => $configured]);
        $this->getJson('/api/v1/config')->assertOk()->assertJsonPath('ai.enabled', true);

        Queue::fake();
        $run = AiRun::query()->findOrFail(
            $this->actingAs($author)->fromWebApp()
                ->postJson("/api/v1/documents/{$document->id}/ai/digest")
                ->assertStatus(202)
                ->json('id'),
        );

        // The operator selects a provider this instance has no credential for.
        config(['kedge.ai.enabled' => $switched]);

        $this->getJson('/api/v1/config')->assertOk()->assertJsonPath('ai.enabled', false);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/ai/digest")
            ->assertNotFound();

        // Scripted deliberately: if the worker's re-check leaked, this run would
        // COMPLETE, and the test would be watching it spend.
        ReviewDigestAgent::fake([[
            'themes' => [['title' => 'Anchoring', 'summary' => 'Anchors keep coming up.']],
            'contention_points' => [],
            'consensus' => [],
            'action_items' => [],
        ]]);

        (new GenerateAiRunJob($run->id))->handle(
            app(AiRunLedger::class),
            app(AiGeneratorRegistry::class),
            app(AiFailureClassifier::class),
        );

        $run->refresh();

        $this->assertSame(AiRunStatus::Failed, $run->status);
        $this->assertSame('ai_disabled', $run->error['code']);
        $this->assertSame(0, $run->tokens, 'A refused run must not have billed anything.');
        ReviewDigestAgent::assertNeverPrompted();
    }

    /**
     * The structural half of "no provider-specific call site outside config"
     * (SPEC §14): application code may not spell a provider id at all. Config is
     * the only place a provider is named — config/kedge.php selects one, and the
     * SDK's published table in config/ai.php says what each one needs.
     *
     * Asserted by scanning for provider ids as PHP STRING LITERALS, so prose in a
     * docblock explaining the certified path stays legal while a call site
     * pinning a provider does not.
     */
    public function test_no_provider_is_named_in_application_code(): void
    {
        /** @var array<string, mixed> $providers */
        $providers = require base_path('config/ai.php');
        $ids = array_keys($providers['providers']);

        $offenders = [];

        foreach ($this->phpFilesIn(app_path()) as $file) {
            preg_match_all("/'([a-z0-9.\\-]+)'/", (string) file_get_contents($file), $matches);

            foreach (array_intersect($matches[1], $ids) as $named) {
                $offenders[] = str_replace(base_path().'/', '', $file).' names "'.$named.'"';
            }
        }

        $this->assertSame([], array_values(array_unique($offenders)),
            'A provider may only be named in config. Read config("kedge.ai.provider") instead.');
    }

    /**
     * A ready document its author can ask for a digest on.
     *
     * @return array{User, Document}
     */
    private function reviewedDocument(): array
    {
        $author = app(RegistrationService::class)->register(
            name: 'Author',
            email: 'author@example.com',
            password: 'correct-horse-battery',
        );

        $document = Document::factory()
            ->for($author->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $author->id, 'title' => 'Anchoring RFC']);

        $content = "# Anchoring RFC\n\nAnchors survive versions.";
        $version = DocumentVersion::factory()->for($document)->create([
            'content_raw' => $content,
            'content_normalized' => $content,
            'content_hash' => hash('sha256', $content),
            'plain_text' => 'Anchors survive versions.',
            'projection_version' => '2',
        ]);

        $document->forceFill(['current_version_id' => $version->id])->save();

        return [$author, $document->refresh()];
    }

    /**
     * @return list<string>
     */
    private function phpFilesIn(string $directory): array
    {
        $files = [];

        /** @var \SplFileInfo $file */
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($directory)) as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $files[] = $file->getPathname();
            }
        }

        sort($files);

        return $files;
    }

    /**
     * Evaluate config/kedge.php against a substituted environment, then put the
     * process's own environment back exactly as it was — the rest of the suite
     * reads it too.
     *
     * Every credential the matrix knows about is CLEARED first, so a case says
     * precisely what is configured and a developer's real `.env` cannot green a
     * case that would be red in CI.
     *
     * @param  array<string, string>  $environment
     * @return array<string, mixed>
     */
    private function configUnder(array $environment): array
    {
        $keys = array_unique([...self::CREDENTIALS, ...self::SWITCHES, ...array_keys($environment)]);

        $saved = [];

        // All THREE sources Laravel's env repository reads, in its own order:
        // $_SERVER, $_ENV, then getenv(). phpunit.xml populates the last one too,
        // so clearing only the arrays would leave `AI_ENABLED=false` standing
        // behind them and quietly turn every case off.
        foreach ($keys as $key) {
            $saved[$key] = [$_ENV[$key] ?? null, $_SERVER[$key] ?? null, getenv($key)];
            unset($_ENV[$key], $_SERVER[$key]);
            putenv($key);
        }

        try {
            foreach ($environment as $key => $value) {
                $_ENV[$key] = $_SERVER[$key] = $value;
                putenv($key.'='.$value);
            }

            /** @var array<string, mixed> $config */
            $config = require base_path('config/kedge.php');

            return $config;
        } finally {
            foreach ($saved as $key => [$env, $server, $putenv]) {
                if ($env === null) {
                    unset($_ENV[$key]);
                } else {
                    $_ENV[$key] = $env;
                }

                if ($server === null) {
                    unset($_SERVER[$key]);
                } else {
                    $_SERVER[$key] = $server;
                }

                if ($putenv === false) {
                    putenv($key);
                } else {
                    putenv($key.'='.$putenv);
                }
            }
        }
    }
}
