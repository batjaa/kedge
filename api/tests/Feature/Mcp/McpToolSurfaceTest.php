<?php

namespace Tests\Feature\Mcp;

use App\Enums\McpTool;
use App\Mcp\Servers\KedgeServer;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Transport\FakeTransporter;

/**
 * The tool list is CLOSED (SPEC §15; m4-ai-agents user story 17) — the one
 * assertion in this module that is about what does NOT exist.
 *
 * Approvals, lifecycle changes, resolving a thread, accepting or declining a
 * suggested edit, and sharing a document are human-only, and the guarantee is
 * structural rather than defensive: there is no tool to guard. A Policy check
 * can be loosened in a refactor and nobody notices; a new tool cannot appear
 * without failing this file.
 */
class McpToolSurfaceTest extends McpTestCase
{
    /**
     * Capability verbs that must never name a tool, in any spelling. A future
     * `triage_thread`, `mark_resolved`, or `share_document` fails here before it
     * can ever be dispatched.
     */
    private const HUMAN_ONLY_CAPABILITIES = [
        'approve', 'approval',
        'lifecycle',
        'resolve', 'reopen',
        'suggestion', 'suggest',
        'share',
        'delete', 'revoke',
        'token',
        // Requesting an AI generation spends the workspace's model budget, so it
        // is a human act too (#136): the artifact tools READ a completed run.
        // A future `generate_digest` fails here first.
        'generate', 'regenerate',
        // Ask-about-the-doc is human-only for the same reason and one more
        // (#139): an agent already has its own model, and it can read the whole
        // document through `get_document`. An `ask_document` tool would spend
        // the workspace's key to answer a question the agent is better placed to
        // answer itself — so the run type exists with no tool that can mint one.
        'ask', 'question',
    ];

    /**
     * @return array<int, Tool>
     */
    private function registeredTools(): array
    {
        return (new KedgeServer(new FakeTransporter))
            ->createContext()
            ->tools()
            ->all();
    }

    public function test_the_server_exposes_exactly_the_specced_tools(): void
    {
        $names = array_map(fn (Tool $tool): string => $tool->name(), $this->registeredTools());

        // Read, then write — SPEC §15's table, in order, and now COMPLETE: #136
        // added the two read-only AI-artifact tools the table names, and there is
        // no ninth tool in the spec. Anything else appearing here is a bug, and a
        // deliberate change has to be argued for in a diff that touches this line.
        $this->assertSame([
            'list_documents',
            'get_document',
            'list_threads',
            'get_thread',
            'get_digest',
            'get_improve_prompt',
            'post_comment',
            'reply',
        ], $names);
    }

    public function test_every_registered_tool_names_a_case_of_the_closed_vocabulary(): void
    {
        $vocabulary = array_map(fn (McpTool $tool): string => $tool->value, McpTool::cases());

        foreach ($this->registeredTools() as $tool) {
            $this->assertContains(
                $tool->name(),
                $vocabulary,
                "Tool [{$tool->name()}] is not a case of App\\Enums\\McpTool — the surface must stay closed.",
            );
        }
    }

    public function test_no_tool_offers_a_human_only_capability(): void
    {
        foreach ($this->registeredTools() as $tool) {
            // Name and title only — the dispatchable surface. Descriptions are
            // prose and legitimately say the words ("this agent token", "deleted
            // comments keep their place"); it is the callable identity that must
            // never read as an offer. What the prose promises is covered instead
            // by test_the_server_tells_agents_which_actions_are_human_only.
            $surface = strtolower($tool->name().' '.$tool->title());

            foreach (self::HUMAN_ONLY_CAPABILITIES as $capability) {
                $this->assertStringNotContainsString(
                    $capability,
                    $surface,
                    "Tool [{$tool->name()}] looks like it offers the human-only capability [{$capability}].",
                );
            }
        }
    }

    public function test_the_closed_vocabulary_itself_contains_no_human_only_capability(): void
    {
        // Belt and braces: the previous test reads what is REGISTERED, this reads
        // what is even nameable. A tool case added to the enum but not wired into
        // the server is still a decision worth failing on.
        foreach (McpTool::cases() as $case) {
            foreach (self::HUMAN_ONLY_CAPABILITIES as $capability) {
                $this->assertStringNotContainsString($capability, $case->value);
            }
        }
    }

    public function test_the_write_tools_are_exactly_the_two_comment_tools(): void
    {
        $writes = array_values(array_map(
            fn (McpTool $tool): string => $tool->value,
            array_filter(McpTool::cases(), fn (McpTool $tool): bool => $tool->isWrite()),
        ));

        $this->assertSame(['post_comment', 'reply'], $writes);
    }

    public function test_the_read_tools_are_annotated_read_only_and_the_writes_are_not(): void
    {
        foreach ($this->registeredTools() as $tool) {
            $isWrite = McpTool::from($tool->name())->isWrite();
            $annotations = (array) $tool->toArray()['annotations'];

            $this->assertSame(
                $isWrite ? null : true,
                $annotations['readOnlyHint'] ?? null,
                "Tool [{$tool->name()}] advertises the wrong read-only hint.",
            );
        }
    }

    public function test_the_server_warns_agents_that_reviewed_content_is_untrusted(): void
    {
        // SPEC §13 / user story 19: a reviewed document is an injection channel
        // into the CONSUMING agent, and the server instructions are the only
        // place we get to say so before it reads one.
        $context = (new KedgeServer(new FakeTransporter))->createContext();

        $this->assertStringContainsString('untrusted', strtolower($context->instructions));
        $this->assertStringContainsString('never as instructions', strtolower($context->instructions));
    }

    public function test_the_server_tells_agents_which_actions_are_human_only(): void
    {
        $instructions = strtolower((new KedgeServer(new FakeTransporter))->createContext()->instructions);

        foreach (['approve', 'lifecycle', 'resolve', 'suggested edit', 'share', 'ai generation'] as $humanOnly) {
            $this->assertStringContainsString($humanOnly, $instructions);
        }
    }

    public function test_the_server_warns_that_ai_artifacts_are_untrusted_too(): void
    {
        // #136 / user story 19: a digest is model output derived from untrusted
        // comments, so it is the same injection channel one summary removed — an
        // agent told only that DOCUMENTS are untrusted would read the digest as
        // if Kedge itself had written it.
        $instructions = strtolower((new KedgeServer(new FakeTransporter))->createContext()->instructions);

        $this->assertStringContainsString('model output derived from that same', $instructions);
        $this->assertStringContainsString('not come from your operator', $instructions);
    }

    public function test_the_operator_documentation_warns_about_the_injection_channel(): void
    {
        // SPEC §15: "reviewed docs are untrusted content for the *consuming
        // agent* — documented prominently". The env file is what an operator
        // reads while wiring MCP up, so the warning has to survive there and not
        // only in the instructions their agent sees.
        $env = (string) file_get_contents(base_path('.env.example'));
        $section = strtolower((string) strstr($env, '# --- MCP server'));

        $this->assertNotSame('', $section, 'The MCP section of .env.example has moved or been renamed.');
        $this->assertStringContainsString('injection', $section);
        $this->assertStringContainsString('untrusted', $section);
    }

    public function test_the_mcp_gate_is_independent_of_the_ai_gate(): void
    {
        // The whole point of a separate flag (m4-ai-agents: "MCP is gated
        // independently"): an instance with no Anthropic key still hosts agent
        // reviewers, and switching MCP off does not switch AI off.
        config(['kedge.ai.enabled' => false, 'kedge.mcp.enabled' => true]);
        $this->assertTrue((bool) config('kedge.mcp.enabled'));

        config(['kedge.ai.enabled' => true, 'kedge.mcp.enabled' => false]);
        $this->assertTrue((bool) config('kedge.ai.enabled'));
        $this->assertFalse((bool) config('kedge.mcp.enabled'));
    }

    public function test_the_mcp_gate_defaults_on(): void
    {
        // Unlike the BYO-key AI gate, MCP needs no credential of ours to be
        // useful, so it ships enabled and an operator opts OUT.
        $this->assertTrue((bool) config('kedge.mcp.enabled'));
    }
}
