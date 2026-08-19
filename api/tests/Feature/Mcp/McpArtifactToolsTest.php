<?php

namespace Tests\Feature\Mcp;

use App\Enums\AiRunStatus;
use App\Enums\AiRunType;
use App\Enums\WorkspaceRole;
use App\Mcp\Servers\KedgeServer;
use App\Mcp\Tools\GetDigestTool;
use App\Mcp\Tools\GetImprovePromptTool;
use App\Models\AiRun;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Workspace;
use App\Services\AI\Artifacts\StalenessReport;
use App\Services\AI\Builders\DigestPromptBuilder;
use App\Services\AI\Builders\ImprovePromptBuilder;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\Fluent\AssertableJson;

/**
 * The two AI-artifact tools (SPEC §15; user story 16; #136): an agent pulls the
 * review's marching orders directly instead of a human copy-pasting them.
 *
 * Three promises are tested here rather than assumed:
 *
 *  - **Neither tool can generate.** Generation spends the workspace's Anthropic
 *    key, so it stays a human act in the app; an agent that could start one could
 *    burn the key in a loop.
 *  - **Only a completed run is served** — never a pending, running, or failed one,
 *    whose empty output an agent would read as "the review said nothing".
 *  - **Every artifact says how old it is** (G3): the version it was built against,
 *    the thread count it saw, its coverage statement, and a stale flag that flips
 *    when either has moved.
 */
class McpArtifactToolsTest extends McpTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Belt and braces on "no live model call in any suite": nothing in these
        // tools should make an outbound request, and an escape fails loudly here.
        Http::preventStrayRequests();

        config(['kedge.ai.enabled' => true]);
    }

    // ---- Serving the latest completed artifact -----------------------------

    public function test_get_digest_serves_the_latest_completed_digest_with_its_staleness_metadata(): void
    {
        $this->threadOn($this->document);
        $run = $this->completedRun(AiRunType::Digest);

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDigestTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertHasNoErrors()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('document_id', $this->document->id)
                ->where('type', 'digest')
                ->where('ai_enabled', true)
                ->where('note', null)
                ->where('artifact.ai_run_id', $run->id)
                ->where('artifact.type', 'digest')
                ->where('artifact.model', 'claude-sonnet-5')
                ->where('artifact.output.themes.0.title', 'Anchoring is the moat')
                // Coverage is lifted out of `output` and served as its own field,
                // verbatim — the artifact's confession of what it did not read.
                ->where('artifact.coverage.statement', 'Covers all 1 thread.')
                ->where('artifact.coverage.covered', 1)
                ->missing('artifact.output.coverage')
                ->where('artifact.stale', false)
                ->where('artifact.stale_reasons', [])
                ->where('artifact.built_against_version_id', $this->version->id)
                ->where('artifact.current_version_id', $this->version->id)
                ->where('artifact.threads_at_generation', 1)
                ->where('artifact.current_threads', 1)
                ->has('artifact.generated_at')
                ->has('artifact.requested_at')
                ->etc());
    }

    public function test_get_improve_prompt_serves_the_latest_completed_prompt(): void
    {
        $this->threadOn($this->document);
        $run = $this->completedRun(AiRunType::ImprovePrompt);

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetImprovePromptTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertHasNoErrors()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('type', 'improve_prompt')
                ->where('artifact.ai_run_id', $run->id)
                ->where('artifact.output.prompt', "# Revise: RFC 017 — Anchoring\n\nMake the anchoring claim testable.")
                ->where('artifact.output.required_edits', 1)
                ->where('artifact.coverage.statement', 'Covers all 1 open thread.')
                ->where('artifact.stale', false)
                ->etc());
    }

    public function test_each_tool_serves_only_its_own_run_type(): void
    {
        // A completed improve-prompt is not a digest: dedupe and re-attach are
        // per (document, type) on REST, and the agent surface must not blur them.
        $this->threadOn($this->document);
        $this->completedRun(AiRunType::ImprovePrompt);

        $this->assertNoArtifact(GetDigestTool::class, 'No review digest has been generated');
    }

    public function test_a_completed_artifact_survives_a_newer_run_being_in_flight(): void
    {
        $this->threadOn($this->document);
        $completed = $this->completedRun(AiRunType::Digest);
        $this->runInState(AiRunType::Digest, AiRunStatus::Running);

        // The panel re-attaches to whatever is happening now; an agent asks what
        // the review currently SAYS, and a run with no output yet is not an answer.
        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDigestTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('artifact.ai_run_id', $completed->id)
                ->etc());
    }

    public function test_a_newer_failed_run_never_hides_the_last_good_artifact(): void
    {
        $this->threadOn($this->document);
        $completed = $this->completedRun(AiRunType::Digest);
        $this->runInState(AiRunType::Digest, AiRunStatus::Failed);

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDigestTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('artifact.ai_run_id', $completed->id)
                ->etc());
    }

    public function test_a_pending_run_is_never_served_as_an_artifact(): void
    {
        $this->runInState(AiRunType::Digest, AiRunStatus::Pending);

        $this->assertNoArtifact(GetDigestTool::class, 'No review digest has been generated');
    }

    public function test_a_failed_run_is_never_served_as_an_artifact(): void
    {
        // Serving one would hand an agent a null output it would read as "the
        // review said nothing" rather than "the generation broke".
        $this->runInState(AiRunType::ImprovePrompt, AiRunStatus::Failed);

        $this->assertNoArtifact(GetImprovePromptTool::class, 'No improve-the-doc prompt has been generated');
    }

    public function test_the_newest_completed_run_wins(): void
    {
        $this->threadOn($this->document);
        $this->completedRun(AiRunType::Digest);
        $newest = $this->completedRun(AiRunType::Digest);

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDigestTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('artifact.ai_run_id', $newest->id)
                ->etc());
    }

    // ---- Staleness (G3) ----------------------------------------------------

    public function test_a_new_thread_since_the_run_makes_the_artifact_stale(): void
    {
        $this->threadOn($this->document);
        $this->completedRun(AiRunType::Digest);

        // Wednesday happened: a reviewer opened a thread the digest never read.
        $this->threadOn($this->document, body: 'A point raised after the digest.');

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDigestTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('artifact.stale', true)
                ->where('artifact.stale_reasons', [StalenessReport::REASON_THREADS_MOVED])
                ->where('artifact.threads_at_generation', 1)
                ->where('artifact.current_threads', 2)
                ->where('note', 'Do not treat this artifact as current: the review has moved from 1 to 2 threads. '
                    .'Re-read the document and its threads before acting on it.')
                ->etc());
    }

    public function test_a_re_synced_document_makes_the_artifact_stale(): void
    {
        $this->threadOn($this->document);
        $this->completedRun(AiRunType::ImprovePrompt);

        $resynced = $this->resync($this->document);

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetImprovePromptTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('artifact.stale', true)
                ->where('artifact.stale_reasons', [StalenessReport::REASON_VERSION_MOVED])
                ->where('artifact.built_against_version_id', $this->version->id)
                ->where('artifact.current_version_id', $resynced->id)
                ->etc());
    }

    public function test_both_movements_are_reported_together(): void
    {
        $this->threadOn($this->document);
        $this->completedRun(AiRunType::Digest);

        $this->resync($this->document);
        $this->threadOn($this->document, body: 'Raised against the new version.');

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDigestTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('artifact.stale', true)
                ->where('artifact.stale_reasons', [
                    StalenessReport::REASON_VERSION_MOVED,
                    StalenessReport::REASON_THREADS_MOVED,
                ])
                ->etc());
    }

    public function test_an_artifact_that_never_recorded_its_scope_is_reported_stale(): void
    {
        // "We cannot tell" and "it is current" are different answers, and only
        // one of them is safe to act on.
        $this->completedRun(AiRunType::Digest, ['input' => null]);

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDigestTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('artifact.stale', true)
                ->where('artifact.stale_reasons', [StalenessReport::REASON_UNKNOWN_BASELINE])
                ->where('artifact.built_against_version_id', null)
                ->where('artifact.threads_at_generation', null)
                ->etc());
    }

    // ---- Honest emptiness --------------------------------------------------

    public function test_a_document_with_no_run_yet_returns_an_empty_result_not_an_error(): void
    {
        $this->assertNoArtifact(GetDigestTool::class, 'No review digest has been generated');
        $this->assertNoArtifact(GetImprovePromptTool::class, 'No improve-the-doc prompt has been generated');
    }

    public function test_the_empty_result_says_generation_is_a_human_action(): void
    {
        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDigestTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertSee('no MCP tool can start a run');
    }

    public function test_an_instance_with_no_ai_configured_returns_an_empty_result_not_an_error(): void
    {
        // MCP is gated INDEPENDENTLY of AI: a keyless self-host hosts agent
        // reviewers, and these two tools report the absence rather than failing.
        config(['kedge.ai.enabled' => false]);

        foreach ([GetDigestTool::class, GetImprovePromptTool::class] as $tool) {
            KedgeServer::actingAs($this->agentFor())
                ->tool($tool, ['document_id' => $this->document->id])
                ->assertOk()
                ->assertHasNoErrors()
                ->assertStructuredContent(fn (AssertableJson $json) => $json
                    ->where('ai_enabled', false)
                    ->where('artifact', null)
                    ->where('note', fn (string $note): bool => str_contains($note, 'no AI provider configured'))
                    ->etc());
        }
    }

    public function test_a_completed_artifact_is_withheld_once_the_key_is_gone(): void
    {
        // With no key the whole AI surface is withdrawn — the REST routes 404 and
        // the web hides the panels. MCP must not be the one back door still
        // serving artifacts the rest of the product no longer offers.
        $this->threadOn($this->document);
        $this->completedRun(AiRunType::Digest);

        config(['kedge.ai.enabled' => false]);

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDigestTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('artifact', null)
                ->where('ai_enabled', false)
                ->etc());
    }

    // ---- Generation stays a human act --------------------------------------

    public function test_neither_tool_can_trigger_a_generation(): void
    {
        Queue::fake();
        $this->threadOn($this->document);
        $agent = $this->agentFor();

        foreach ([GetDigestTool::class, GetImprovePromptTool::class] as $tool) {
            KedgeServer::actingAs($agent)->tool($tool, ['document_id' => $this->document->id])->assertOk();
            KedgeServer::actingAs($agent)->tool($tool, ['document_id' => $this->document->id])->assertOk();
        }

        // No run minted, no job queued, no model reached — an agent hammering
        // these tools cannot spend a cent of the workspace's key.
        $this->assertSame(0, AiRun::query()->count());
        Queue::assertNothingPushed();
    }

    public function test_reading_an_artifact_does_not_disturb_the_run_that_produced_it(): void
    {
        $this->threadOn($this->document);
        $run = $this->completedRun(AiRunType::Digest);
        $before = $run->only(['status', 'output', 'tokens', 'cost', 'updated_at']);

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDigestTool::class, ['document_id' => $this->document->id])
            ->assertOk();

        $this->assertSame(1, AiRun::query()->count());
        $this->assertEquals($before, $run->fresh()?->only(['status', 'output', 'tokens', 'cost', 'updated_at']));
    }

    // ---- Policy resolution and workspace scoping ---------------------------

    public function test_another_workspaces_document_is_refused_indistinguishably(): void
    {
        $stranger = Workspace::create(['name' => 'Stranger', 'slug' => 'stranger']);
        [$foreign] = $this->readyDocument($stranger, 'Not yours');
        AiRun::factory()->for($foreign)->completed()->create([
            'workspace_id' => $foreign->workspace_id,
            'created_by' => $this->operator->id,
            'type' => AiRunType::Digest,
        ]);

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDigestTool::class, ['document_id' => $foreign->id])
            ->assertHasErrors(['No document is available']);
    }

    public function test_a_token_scoped_to_another_workspace_cannot_read_artifacts(): void
    {
        // G2, through the shared Policy membership trait: the operator IS a member
        // here, but the credential does not name this workspace.
        $other = Workspace::create(['name' => 'Other', 'slug' => 'other']);
        $this->operator->workspaces()->attach($other->id, ['role' => WorkspaceRole::Member->value]);
        $this->threadOn($this->document);
        $this->completedRun(AiRunType::Digest);

        KedgeServer::actingAs($this->agentFor($other))
            ->tool(GetDigestTool::class, ['document_id' => $this->document->id])
            ->assertHasErrors(['No document is available']);
    }

    public function test_a_missing_document_and_a_malformed_id_are_refused(): void
    {
        KedgeServer::actingAs($this->agentFor())
            ->tool(GetImprovePromptTool::class, ['document_id' => 9_999_999])
            ->assertHasErrors(['No document is available']);

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetImprovePromptTool::class, ['document_id' => '12abc'])
            ->assertHasErrors(['must be a positive integer id']);
    }

    // ---- Helpers -----------------------------------------------------------

    /**
     * @param  class-string  $tool
     */
    private function assertNoArtifact(string $tool, string $note): void
    {
        KedgeServer::actingAs($this->agentFor())
            ->tool($tool, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertHasNoErrors()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('artifact', null)
                ->where('ai_enabled', true)
                ->where('note', fn (string $value): bool => str_contains($value, $note))
                ->etc());
    }

    /**
     * A run in whatever state, with no output — the shapes that must never be
     * served as an artifact.
     */
    private function runInState(AiRunType $type, AiRunStatus $status): AiRun
    {
        return AiRun::factory()->for($this->document)->create([
            'workspace_id' => $this->workspace->id,
            'created_by' => $this->operator->id,
            'type' => $type,
            'status' => $status,
        ]);
    }

    /**
     * A completed run whose recorded scope matches the document as it stands —
     * exactly what the builders freeze into `ai_runs.input` before the first
     * model call, so "fresh" here means what it means in production.
     *
     * @param  array<string, mixed>  $overrides
     */
    private function completedRun(AiRunType $type, array $overrides = []): AiRun
    {
        $document = $this->document->fresh();

        // The baseline comes from the REAL builder rather than from the staleness
        // service, so "fresh" here cannot be true by construction: if the two ever
        // disagree about which threads a run reads, these tests go red.
        $threadTotal = $type === AiRunType::ImprovePrompt
            ? app(ImprovePromptBuilder::class)->build($document)->meta()['thread_total']
            : app(DigestPromptBuilder::class)->build($document)->meta['thread_total'];

        return AiRun::factory()->for($this->document)->create($overrides + [
            'workspace_id' => $this->workspace->id,
            'created_by' => $this->operator->id,
            'type' => $type,
            'status' => AiRunStatus::Completed,
            'input' => [
                'document_id' => $this->document->id,
                'document_version_id' => $this->document->current_version_id,
                'thread_total' => $threadTotal,
            ],
            'output' => $type === AiRunType::ImprovePrompt
                ? $this->improvePromptOutput()
                : $this->digestOutput(),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function digestOutput(): array
    {
        return [
            'themes' => [['title' => 'Anchoring is the moat', 'summary' => 'Reviewers keep returning to it.']],
            'contention_points' => [],
            'consensus' => [],
            'action_items' => [],
            'coverage' => [
                'covered' => 1,
                'total' => 1,
                'chunked' => false,
                'statement' => 'Covers all 1 thread.',
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function improvePromptOutput(): array
    {
        return [
            'prompt' => "# Revise: RFC 017 — Anchoring\n\nMake the anchoring claim testable.",
            'required_edits' => 1,
            'threads' => 1,
            'coverage' => [
                'covered' => 1,
                'total' => 1,
                'chunked' => false,
                'statement' => 'Covers all 1 open thread.',
            ],
        ];
    }

    /**
     * A re-sync: a new version becomes the document's current one, exactly as the
     * re-sync pipeline flips it.
     */
    private function resync(Document $document): DocumentVersion
    {
        $content = "# {$document->title}\n\nRewritten after review.\n";

        $version = DocumentVersion::factory()->for($document)->create([
            'content_raw' => $content,
            'content_normalized' => $content,
            'content_hash' => hash('sha256', $content),
            'plain_text' => 'Rewritten after review.',
            'projection_version' => (string) config('kedge.projection.current_version'),
        ]);

        $document->forceFill(['current_version_id' => $version->id])->save();

        return $version;
    }
}
