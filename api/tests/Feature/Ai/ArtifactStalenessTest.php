<?php

namespace Tests\Feature\Ai;

use App\Enums\AiRunStatus;
use App\Enums\AiRunType;
use App\Models\AiRun;
use App\Models\Comment;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Thread;
use App\Models\User;
use App\Services\AI\AiArtifactStaleness;
use App\Services\AI\Artifacts\StalenessReport;
use App\Services\AI\Builders\DigestPromptBuilder;
use App\Services\AI\Builders\ImprovePromptBuilder;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Staleness metadata for completed AI artifacts (m4-ai-agents eng review §4,
 * G3, #136) — the service the MCP tools serve and the web panels will read.
 *
 * The load-bearing tests here are the two AGREEMENT ones. Staleness compares a
 * baseline the BUILDER froze into `ai_runs.input` against the same population
 * counted NOW, and the two run types read different populations: a digest reads
 * every thread, an improve-prompt reads open threads that still carry something
 * to act on. Two counters can drift apart silently and mis-flag every artifact
 * on the instance, so they are pinned against the builders themselves rather
 * than against a number this file made up.
 */
class ArtifactStalenessTest extends TestCase
{
    use RefreshDatabase;

    private User $author;

    private Document $document;

    private DocumentVersion $version;

    protected function setUp(): void
    {
        parent::setUp();

        // Nothing here may reach a provider: the builders assemble prompts, they
        // do not call models.
        Http::preventStrayRequests();

        $this->author = app(RegistrationService::class)->register(
            name: 'Author',
            email: 'author@example.com',
            password: 'correct-horse-battery',
        );

        [$this->document, $this->version] = $this->reviewedDocument();
    }

    // ---- The baseline and the live count are the same rule -----------------

    public function test_the_digest_thread_count_matches_what_the_digest_builder_records(): void
    {
        // Every thread on the document, whatever its status and whatever its
        // comments say — DigestPromptBuilder's own total.
        $recorded = app(DigestPromptBuilder::class)->build($this->document)->meta['thread_total'];

        $this->assertSame(4, $recorded, 'The fixture should carry four threads of assorted kinds.');
        $this->assertSame(
            $recorded,
            app(AiArtifactStaleness::class)->threadsNow($this->document, AiRunType::Digest),
        );
    }

    public function test_the_improve_prompt_thread_count_matches_what_its_builder_records(): void
    {
        // Open threads that still carry something to act on: the resolved one,
        // the declined-only one, and the deleted-only one are all excluded — by
        // the builder, and so by staleness.
        $recorded = app(ImprovePromptBuilder::class)->build($this->document)->meta()['thread_total'];

        $this->assertSame(1, $recorded, 'Only the open thread with live, non-declined feedback carries.');
        $this->assertSame(
            $recorded,
            app(AiArtifactStaleness::class)->threadsNow($this->document, AiRunType::ImprovePrompt),
        );
    }

    // ---- Fresh, and then not (G3) ------------------------------------------

    public function test_a_run_built_from_the_current_state_is_not_stale(): void
    {
        foreach ([AiRunType::Digest, AiRunType::ImprovePrompt] as $type) {
            $report = app(AiArtifactStaleness::class)->for($this->completedRun($type), $this->document);

            $this->assertFalse($report->stale, "A fresh {$type->value} run should not be stale.");
            $this->assertSame([], $report->reasons);
            $this->assertNull($report->statement());
            $this->assertSame($this->version->id, $report->builtAgainstVersionId);
            $this->assertSame($this->version->id, $report->currentVersionId);
        }
    }

    public function test_a_new_thread_ages_both_artifacts(): void
    {
        $digest = $this->completedRun(AiRunType::Digest);
        $prompt = $this->completedRun(AiRunType::ImprovePrompt);

        $this->thread('open', [['body' => 'Something nobody has answered yet.']]);

        foreach ([$digest, $prompt] as $run) {
            $report = app(AiArtifactStaleness::class)->for($run->fresh(), $this->document->fresh());

            $this->assertTrue($report->stale);
            $this->assertSame([StalenessReport::REASON_THREADS_MOVED], $report->reasons);
            $this->assertStringContainsString('Re-read the document', (string) $report->statement());
        }
    }

    public function test_resolving_a_thread_ages_the_improve_prompt_and_leaves_the_digest_alone(): void
    {
        // Deliberate, and the reason the two counts are not one count: an
        // improve-prompt is marching orders, so triaging its last live thread
        // makes it obsolete. A digest summarizes the whole conversation,
        // resolved threads included, so it still describes what was said.
        $digest = $this->completedRun(AiRunType::Digest);
        $prompt = $this->completedRun(AiRunType::ImprovePrompt);

        Thread::query()
            ->where('document_id', $this->document->id)
            ->where('status', 'open')
            ->whereHas('comments', fn ($query) => $query->whereNull('suggestion_status'))
            ->update(['status' => 'resolved']);

        $this->assertFalse(app(AiArtifactStaleness::class)->for($digest, $this->document)->stale);
        $this->assertTrue(app(AiArtifactStaleness::class)->for($prompt, $this->document)->stale);
    }

    public function test_a_re_synced_document_ages_the_artifact(): void
    {
        $run = $this->completedRun(AiRunType::Digest);

        $content = "# Anchoring RFC\n\nRewritten after the review.";
        $next = DocumentVersion::factory()->for($this->document)->create([
            'content_raw' => $content,
            'content_normalized' => $content,
            'content_hash' => hash('sha256', $content),
            'plain_text' => 'Rewritten after the review.',
            'projection_version' => '2',
        ]);
        $this->document->forceFill(['current_version_id' => $next->id])->save();

        $report = app(AiArtifactStaleness::class)->for($run, $this->document->fresh());

        $this->assertTrue($report->stale);
        $this->assertSame([StalenessReport::REASON_VERSION_MOVED], $report->reasons);
        $this->assertSame($this->version->id, $report->builtAgainstVersionId);
        $this->assertSame($next->id, $report->currentVersionId);
    }

    public function test_a_run_that_recorded_no_scope_cannot_be_called_fresh(): void
    {
        $run = $this->completedRun(AiRunType::Digest, ['input' => null]);

        $report = app(AiArtifactStaleness::class)->for($run, $this->document);

        $this->assertTrue($report->stale);
        $this->assertSame([StalenessReport::REASON_UNKNOWN_BASELINE], $report->reasons);
        $this->assertStringContainsString('does not record what it was generated from', (string) $report->statement());
    }

    public function test_a_garbled_baseline_is_treated_as_no_baseline(): void
    {
        // `input` is a free-form JSON column: a key can be present and useless,
        // and casting "many" to 0 would call a stale artifact fresh.
        $run = $this->completedRun(AiRunType::Digest, [
            'input' => ['document_version_id' => 'v2', 'thread_total' => 'many'],
        ]);

        $report = app(AiArtifactStaleness::class)->for($run, $this->document);

        $this->assertTrue($report->stale);
        $this->assertSame([StalenessReport::REASON_UNKNOWN_BASELINE], $report->reasons);
        $this->assertNull($report->threadsAtGeneration);
    }

    // ---- Fixtures ----------------------------------------------------------

    /**
     * A completed run whose recorded scope is what the real builder would have
     * frozen for this document right now.
     *
     * @param  array<string, mixed>  $overrides
     */
    private function completedRun(AiRunType $type, array $overrides = []): AiRun
    {
        $threadTotal = $type === AiRunType::ImprovePrompt
            ? app(ImprovePromptBuilder::class)->build($this->document)->meta()['thread_total']
            : app(DigestPromptBuilder::class)->build($this->document)->meta['thread_total'];

        return AiRun::factory()->for($this->document)->create($overrides + [
            'workspace_id' => $this->document->workspace_id,
            'created_by' => $this->author->id,
            'type' => $type,
            'status' => AiRunStatus::Completed,
            'input' => [
                'document_id' => $this->document->id,
                'document_version_id' => $this->document->current_version_id,
                'thread_total' => $threadTotal,
            ],
            'output' => ['coverage' => ['covered' => 1, 'total' => 1, 'chunked' => false, 'statement' => 'Covers all 1 thread.']],
        ]);
    }

    /**
     * A ready document carrying one thread of each kind the two populations
     * disagree about.
     *
     * @return array{Document, DocumentVersion}
     */
    private function reviewedDocument(): array
    {
        $document = Document::factory()
            ->for($this->author->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $this->author->id, 'title' => 'Anchoring RFC']);

        $content = "# Anchoring RFC\n\nAnchors survive versions.";
        $version = DocumentVersion::factory()->for($document)->create([
            'content_raw' => $content,
            'content_normalized' => $content,
            'content_hash' => hash('sha256', $content),
            'plain_text' => 'Anchors survive versions.',
            'projection_version' => '2',
        ]);

        $document->forceFill(['current_version_id' => $version->id])->save();
        $this->document = $document->refresh();

        // Carries: open, with live feedback nobody has declined.
        $this->thread('open', [['body' => 'The anchoring claim needs a test.']]);

        // Does not carry: already triaged.
        $this->thread('resolved', [['body' => 'Fixed in the last pass.']]);

        // Does not carry: the author already said no to the only thing in it.
        $this->thread('open', [[
            'body' => 'Replace the whole section.',
            'type' => 'suggestion',
            'proposed' => 'Nothing here.',
            'status' => 'declined',
        ]]);

        // Does not carry: its only comment was deleted.
        $deleted = $this->thread('open', [['body' => 'Withdrawn.']]);
        Comment::query()->where('thread_id', $deleted->id)->delete();

        return [$document->refresh(), $version];
    }

    /**
     * @param  list<array<string, mixed>>  $comments
     */
    private function thread(string $status, array $comments): Thread
    {
        $thread = Thread::create([
            'document_id' => $this->document->id,
            'type' => 'document',
            'status' => $status,
            'created_by' => $this->author->id,
        ]);

        foreach ($comments as $comment) {
            $thread->comments()->create([
                'author_id' => $this->author->id,
                'body_md' => $comment['body'],
                'type' => $comment['type'] ?? 'comment',
                'proposed_text' => $comment['proposed'] ?? null,
                'suggestion_status' => $comment['status'] ?? null,
            ]);
        }

        return $thread;
    }
}
