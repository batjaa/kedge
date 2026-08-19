<?php

namespace Tests\Feature\Ai;

use App\Enums\AiRunType;
use App\Enums\WorkspaceRole;
use App\Models\AiRun;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\User;
use App\Services\AI\AiRunLedger;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The dedupe exemption at the LEDGER, where it lives (SPEC §14 "Ask about the
 * doc", M4 #139).
 *
 * Two properties, and both have to hold or the feature is wrong rather than
 * merely expensive:
 *
 *  - An ask NEVER joins another ask. Two questions about one document are two
 *    different questions, and joining them would hand the second asker a
 *    confident answer to something they did not ask.
 *  - The exemption reaches EXACTLY one type. Dedupe is what stops a
 *    double-clicked digest from billing the workspace's key twice, so an
 *    exemption that leaked into the other five types would be a spend
 *    regression nobody would notice until the invoice.
 *
 * Asserted here against the ledger rather than only through HTTP, because the
 * rule is a property of the run type and the endpoint is just its first caller.
 */
class AiRunDedupeExemptionTest extends TestCase
{
    use RefreshDatabase;

    public function test_ask_is_the_only_dedupe_exempt_run_type(): void
    {
        $exempt = array_values(array_map(
            fn (AiRunType $type): string => $type->value,
            array_filter(AiRunType::cases(), fn (AiRunType $type): bool => $type->isDedupeExempt()),
        ));

        $this->assertSame(['ask'], $exempt);
    }

    public function test_every_ask_mints_its_own_run_even_while_one_is_in_flight(): void
    {
        [$actor, $document] = $this->readyDocument();
        $ledger = app(AiRunLedger::class);

        [$first, $firstCreated] = $ledger->startOrJoin(
            $document, $actor, AiRunType::Ask, request: ['question' => 'What does re-anchoring do?'],
        );
        [$second, $secondCreated] = $ledger->startOrJoin(
            $document, $actor, AiRunType::Ask, request: ['question' => 'What does re-anchoring do?'],
        );

        $this->assertTrue($firstCreated);
        $this->assertTrue($secondCreated);
        $this->assertNotSame($first->id, $second->id);
        $this->assertSame(2, AiRun::query()->count());

        // The FIRST run is still pending — the exemption mints alongside it
        // rather than reviving or abandoning it.
        $this->assertTrue($first->refresh()->status->isInFlight());
    }

    public function test_two_members_asking_the_same_question_get_their_own_runs(): void
    {
        [$owner, $document] = $this->readyDocument();
        $colleague = $this->member('colleague@example.com');
        $document->workspace->members()->attach($colleague, ['role' => WorkspaceRole::Member->value]);
        $ledger = app(AiRunLedger::class);

        [$mine] = $ledger->startOrJoin($document, $owner, AiRunType::Ask, request: ['question' => 'Why?']);
        [$theirs] = $ledger->startOrJoin($document, $colleague, AiRunType::Ask, request: ['question' => 'Why?']);

        $this->assertNotSame($mine->id, $theirs->id);
        $this->assertSame($owner->id, $mine->created_by);
        $this->assertSame($colleague->id, $theirs->created_by);
    }

    /**
     * The other half of the exemption: it must not leak. Every type that is NOT
     * ask still joins the run in flight, which is what keeps a double-click from
     * billing the key twice.
     *
     * @return array<string, array{AiRunType}>
     */
    public static function dedupingTypes(): array
    {
        return [
            'digest' => [AiRunType::Digest],
            'improve prompt' => [AiRunType::ImprovePrompt],
            'split' => [AiRunType::Split],
            'summary' => [AiRunType::Summary],
            'reply draft' => [AiRunType::ReplyDraft],
        ];
    }

    #[DataProvider('dedupingTypes')]
    public function test_every_other_type_still_joins_the_run_in_flight(AiRunType $type): void
    {
        [$actor, $document] = $this->readyDocument();
        $ledger = app(AiRunLedger::class);

        [$first, $firstCreated] = $ledger->startOrJoin($document, $actor, $type);
        [$second, $secondCreated] = $ledger->startOrJoin($document, $actor, $type);

        $this->assertTrue($firstCreated);
        $this->assertFalse($secondCreated, "Type [{$type->value}] stopped deduping.");
        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, AiRun::query()->count());
    }

    /**
     * An ask does not swallow the deduping types either — the exemption is about
     * how ASKS behave, not a hole punched in the (document, type) key.
     */
    public function test_an_ask_in_flight_does_not_stop_a_digest_from_deduping(): void
    {
        [$actor, $document] = $this->readyDocument();
        $ledger = app(AiRunLedger::class);

        $ledger->startOrJoin($document, $actor, AiRunType::Ask, request: ['question' => 'Why?']);
        [$digest] = $ledger->startOrJoin($document, $actor, AiRunType::Digest);
        [$again, $created] = $ledger->startOrJoin($document, $actor, AiRunType::Digest);

        $this->assertFalse($created);
        $this->assertSame($digest->id, $again->id);
        $this->assertSame(2, AiRun::query()->count());
    }

    public function test_the_question_is_stamped_on_the_minted_run(): void
    {
        [$actor, $document] = $this->readyDocument();

        [$run] = app(AiRunLedger::class)->startOrJoin(
            $document,
            $actor,
            AiRunType::Ask,
            request: ['question' => 'Does the anchor survive a re-sync?', 'quote' => ['exact' => 'Re-anchoring']],
        );

        $this->assertSame('Does the anchor survive a re-sync?', $run->refresh()->requestPayload()['question']);
        $this->assertSame('Re-anchoring', $run->requestPayload()['quote']['exact']);
        $this->assertNull($run->variant);
        $this->assertNull($run->target_type);
    }

    /**
     * @return array{User, Document}
     */
    private function readyDocument(): array
    {
        $owner = $this->member();

        $document = Document::factory()
            ->for($owner->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $owner->id, 'title' => 'Anchoring RFC']);

        $content = "# Anchoring RFC\n\nRe-anchoring keeps a comment attached across versions.";
        $version = DocumentVersion::factory()->for($document)->create([
            'content_raw' => $content,
            'content_normalized' => $content,
            'content_hash' => hash('sha256', $content),
            'plain_text' => 'Re-anchoring keeps a comment attached across versions.',
            'projection_version' => '2',
        ]);

        $document->forceFill(['current_version_id' => $version->id])->save();

        return [$owner, $document];
    }

    private function member(string $email = 'asker@example.com'): User
    {
        return app(RegistrationService::class)->register(
            name: 'Asking User',
            email: $email,
            password: 'correct-horse-battery',
        );
    }
}
