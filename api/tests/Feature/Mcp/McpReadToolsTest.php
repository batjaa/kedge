<?php

namespace Tests\Feature\Mcp;

use App\Enums\WorkspaceRole;
use App\Mcp\Servers\KedgeServer;
use App\Mcp\Tools\GetDocumentTool;
use App\Mcp\Tools\GetThreadTool;
use App\Mcp\Tools\ListDocumentsTool;
use App\Mcp\Tools\ListThreadsTool;
use App\Models\Document;
use App\Models\Thread;
use App\Models\Workspace;
use App\Services\Comments\CommentThreadService;
use Illuminate\Testing\Fluent\AssertableJson;

/**
 * The four read tools (SPEC §15; user story 13): an agent gets the same review
 * context a human reviewer has, through the same Policies, page by page.
 */
class McpReadToolsTest extends McpTestCase
{
    public function test_list_documents_returns_the_workspaces_documents(): void
    {
        $this->readyDocument($this->workspace, 'Second document');

        KedgeServer::actingAs($this->agentFor())
            ->tool(ListDocumentsTool::class)
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->has('documents', 2)
                ->where('documents.0.title', 'Second document')
                ->where('documents.1.title', 'RFC 017 — Anchoring')
                ->where('pagination.total', 2)
                ->where('pagination.has_more', false)
                ->etc());
    }

    public function test_list_documents_paginates_like_every_list_endpoint(): void
    {
        // G11. Three documents, one per page: the agent must be able to walk them
        // and must be TOLD there is more rather than inferring it.
        $this->readyDocument($this->workspace, 'Second document');
        $this->readyDocument($this->workspace, 'Third document');
        $agent = $this->agentFor();

        $first = KedgeServer::actingAs($agent)->tool(ListDocumentsTool::class, ['per_page' => 1]);
        $first->assertOk()->assertStructuredContent(fn (AssertableJson $json) => $json
            ->has('documents', 1)
            ->where('documents.0.title', 'Third document')
            ->where('pagination.page', 1)
            ->where('pagination.per_page', 1)
            ->where('pagination.total', 3)
            ->where('pagination.last_page', 3)
            ->where('pagination.has_more', true)
            ->etc());

        KedgeServer::actingAs($agent)
            ->tool(ListDocumentsTool::class, ['per_page' => 1, 'page' => 3])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->has('documents', 1)
                ->where('documents.0.title', 'RFC 017 — Anchoring')
                ->where('pagination.page', 3)
                ->where('pagination.has_more', false)
                ->etc());
    }

    public function test_list_documents_clamps_an_oversized_page_size(): void
    {
        KedgeServer::actingAs($this->agentFor())
            ->tool(ListDocumentsTool::class, ['per_page' => 5000])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('pagination.per_page', 50)
                ->etc());
    }

    public function test_list_documents_never_reaches_another_workspace(): void
    {
        $stranger = Workspace::create(['name' => 'Stranger', 'slug' => 'stranger']);
        $this->readyDocument($stranger, 'Not yours');

        KedgeServer::actingAs($this->agentFor())
            ->tool(ListDocumentsTool::class)
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->has('documents', 1)
                ->where('documents.0.title', 'RFC 017 — Anchoring')
                ->etc());
    }

    public function test_get_document_returns_the_current_version_with_its_projection(): void
    {
        // The projection is what makes anchoring possible for an agent: offsets
        // are UTF-16 code units into exactly this string.
        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDocumentTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('document.id', $this->document->id)
                ->where('document.title', 'RFC 017 — Anchoring')
                ->where('version.id', $this->version->id)
                ->where('version.plain_text', self::PLAIN_TEXT)
                ->where('version.projection_version', (string) config('kedge.projection.current_version'))
                ->etc());
    }

    public function test_get_document_reads_an_earlier_version_on_request(): void
    {
        [$document, $current] = $this->readyDocument($this->workspace, 'Versioned');
        $older = $document->versions()->create([
            'kind' => 'mainline',
            'content_raw' => '# Old',
            'content_normalized' => '# Old',
            'content_hash' => hash('sha256', 'old'),
            'plain_text' => 'Old',
            'projection_version' => '2',
        ]);

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDocumentTool::class, ['document_id' => $document->id, 'version_id' => $older->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('version.id', $older->id)
                ->where('version.plain_text', 'Old')
                ->etc());

        $this->assertNotSame($older->id, $current->id);
    }

    public function test_get_document_refuses_a_version_belonging_to_another_document(): void
    {
        [, $foreignVersion] = $this->readyDocument($this->workspace, 'Another document');

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDocumentTool::class, [
                'document_id' => $this->document->id,
                'version_id' => $foreignVersion->id,
            ])
            ->assertHasErrors(['has no version with id']);
    }

    public function test_get_document_denies_a_document_in_another_workspace(): void
    {
        $stranger = Workspace::create(['name' => 'Stranger', 'slug' => 'stranger']);
        [$foreign] = $this->readyDocument($stranger, 'Not yours');

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDocumentTool::class, ['document_id' => $foreign->id])
            ->assertHasErrors(['No document is available']);
    }

    public function test_a_missing_and_a_forbidden_document_are_one_answer(): void
    {
        // Token ids are handed to third-party software; the id space must not be
        // an enumeration oracle, so "never existed" and "not yours" read alike.
        $stranger = Workspace::create(['name' => 'Stranger', 'slug' => 'stranger']);
        [$foreign] = $this->readyDocument($stranger, 'Not yours');
        $agent = $this->agentFor();

        $forbidden = KedgeServer::actingAs($agent)
            ->tool(GetDocumentTool::class, ['document_id' => $foreign->id]);
        $missing = KedgeServer::actingAs($agent)
            ->tool(GetDocumentTool::class, ['document_id' => 999999]);

        $forbidden->assertHasErrors(['No document is available at id ['.$foreign->id.']']);
        $missing->assertHasErrors(['No document is available at id [999999]']);
    }

    public function test_get_document_rejects_a_non_numeric_id(): void
    {
        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDocumentTool::class, ['document_id' => '12; drop table documents'])
            ->assertHasErrors(['must be a positive integer id']);
    }

    public function test_list_threads_returns_the_rail_in_document_order(): void
    {
        $this->threadOn($this->document, body: 'First point');
        $this->threadOn($this->document, body: 'Second point');

        KedgeServer::actingAs($this->agentFor())
            ->tool(ListThreadsTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->has('threads', 2)
                ->where('threads.0.type', 'document')
                ->where('threads.0.comment_count', 1)
                ->where('pagination.total', 2)
                ->etc());
    }

    public function test_list_threads_paginates(): void
    {
        // G11 for the second list surface, through the same rail read the web uses.
        $this->threadOn($this->document, body: 'First point');
        $this->threadOn($this->document, body: 'Second point');
        $this->threadOn($this->document, body: 'Third point');

        KedgeServer::actingAs($this->agentFor())
            ->tool(ListThreadsTool::class, ['document_id' => $this->document->id, 'per_page' => 2])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->has('threads', 2)
                ->where('pagination.total', 3)
                ->where('pagination.last_page', 2)
                ->where('pagination.has_more', true)
                ->etc());

        KedgeServer::actingAs($this->agentFor())
            ->tool(ListThreadsTool::class, [
                'document_id' => $this->document->id,
                'per_page' => 2,
                'page' => 2,
            ])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->has('threads', 1)
                ->where('pagination.page', 2)
                ->where('pagination.has_more', false)
                ->etc());
    }

    public function test_list_threads_denies_a_document_in_another_workspace(): void
    {
        $stranger = Workspace::create(['name' => 'Stranger', 'slug' => 'stranger']);
        [$foreign] = $this->readyDocument($stranger, 'Not yours');
        $this->threadOn($foreign, body: 'Private conversation');

        KedgeServer::actingAs($this->agentFor())
            ->tool(ListThreadsTool::class, ['document_id' => $foreign->id])
            ->assertHasErrors(['No document is available'])
            ->assertDontSee('Private conversation');
    }

    public function test_get_thread_returns_the_conversation_with_client_attribution(): void
    {
        $thread = $this->threadOn($this->document, body: 'A human said this');

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetThreadTool::class, ['thread_id' => $thread->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('id', $thread->id)
                ->where('status', 'open')
                ->has('comments', 1)
                ->where('comments.0.body_md', 'A human said this')
                // Who is arguing with whom (user story 15).
                ->where('comments.0.client', 'web')
                ->where('comments.0.author.name', 'Agent Operator')
                ->etc());
    }

    public function test_get_thread_denies_a_thread_in_another_workspace(): void
    {
        $stranger = Workspace::create(['name' => 'Stranger', 'slug' => 'stranger']);
        [$foreign] = $this->readyDocument($stranger, 'Not yours');
        $thread = $this->threadOn($foreign, body: 'Private conversation');

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetThreadTool::class, ['thread_id' => $thread->id])
            ->assertHasErrors(['No thread is available'])
            ->assertDontSee('Private conversation');
    }

    public function test_a_token_scoped_elsewhere_reaches_none_of_its_owners_documents(): void
    {
        // G2 through the tools: the human belongs to both workspaces, the
        // credential names only one, and the shared Policy trait is what stops it.
        $second = Workspace::create(['name' => 'Second Team', 'slug' => 'second-team']);
        $this->operator->workspaces()->attach($second->id, ['role' => WorkspaceRole::Member->value]);
        $agent = $this->agentFor($second);

        KedgeServer::actingAs($agent)
            ->tool(GetDocumentTool::class, ['document_id' => $this->document->id])
            ->assertHasErrors(['No document is available']);

        KedgeServer::actingAs($agent)
            ->tool(ListDocumentsTool::class)
            ->assertHasErrors(['cannot list documents']);
    }

    public function test_the_agent_view_never_advertises_human_only_capabilities(): void
    {
        // The REST resources carry can_resolve / can_reanchor / can_react for the
        // web's buttons. On MCP those would advertise reach the agent does not
        // have and no tool provides.
        $thread = $this->threadOn($this->document);

        $response = KedgeServer::actingAs($this->agentFor())
            ->tool(GetThreadTool::class, ['thread_id' => $thread->id])
            ->assertOk();

        foreach (['can_resolve', 'can_reopen', 'can_reanchor', 'can_edit', 'can_delete', 'can_fork', 'can_react', 'can_resolve_suggestion'] as $capability) {
            $response->assertDontSee($capability);
        }
    }

    public function test_a_thread_the_rail_read_hides_is_hidden_from_the_agent_too(): void
    {
        // The rail drops inline threads with no anchor on the target version; the
        // agent list is the same read, so it must behave identically rather than
        // quietly exposing a thread the web cannot show.
        Thread::create([
            'document_id' => $this->document->id,
            'type' => 'inline',
            'status' => 'open',
            'created_by' => $this->operator->id,
        ]);

        $expected = app(CommentThreadService::class)
            ->listForDocument($this->document, 20, $this->operator)
            ->total();

        KedgeServer::actingAs($this->agentFor())
            ->tool(ListThreadsTool::class, ['document_id' => $this->document->id])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('pagination.total', $expected)
                ->etc());

        $this->assertSame(0, $expected);
        $this->assertSame(1, Document::find($this->document->id)->threads()->count());
    }
}
