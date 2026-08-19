<?php

namespace Tests\Feature\Mcp;

use App\Enums\AuditEvent;
use App\Enums\CommentClient;
use App\Enums\ThreadType;
use App\Mcp\Servers\KedgeServer;
use App\Mcp\Tools\GetDocumentTool;
use App\Mcp\Tools\ListDocumentsTool;
use App\Mcp\Tools\PostCommentTool;
use App\Mcp\Tools\ReplyTool;
use App\Models\AgentToken;
use App\Models\AuditLog;
use App\Models\Comment;
use App\Models\Thread;
use App\Models\Workspace;
use App\Services\Agents\AgentTokenService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\Fluent\AssertableJson;
use Mockery;

/**
 * The two write tools (SPEC §15; user story 14): an agent posts a comment and a
 * reply through the same services and Policies a human's request reaches,
 * stamped as MCP-client and attributed to the token's owner.
 */
class McpWriteToolsTest extends McpTestCase
{
    public function test_post_comment_creates_a_document_level_thread_stamped_as_mcp(): void
    {
        KedgeServer::actingAs($this->agentFor())
            ->tool(PostCommentTool::class, [
                'document_id' => $this->document->id,
                'body' => 'The anchoring section needs a worked example.',
            ])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('thread.type', 'document')
                ->where('thread.comments.0.client', 'mcp')
                ->where('thread.comments.0.body_md', 'The anchoring section needs a worked example.')
                ->etc());

        $comment = Comment::query()->sole();

        // The badge is a stamp on the row, which is why the violet AGENT · MCP
        // treatment lights up with zero web work.
        $this->assertSame(CommentClient::Mcp, $comment->client);
        // ...and the human who minted the token owns what their agent says.
        $this->assertSame($this->operator->id, $comment->author_id);
        $this->assertSame(ThreadType::Document, Thread::query()->sole()->type);
    }

    public function test_post_comment_anchors_a_thread_to_the_selected_passage(): void
    {
        $anchor = $this->anchorPayload();

        KedgeServer::actingAs($this->agentFor())
            ->tool(PostCommentTool::class, [
                'document_id' => $this->document->id,
                'body' => 'Say which projection version this holds for.',
                'anchor' => $anchor,
            ])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('thread.type', 'inline')
                ->where('thread.anchor.exact', 'survive versions')
                ->where('thread.anchor.start', $anchor['start'])
                ->etc());

        $persisted = Thread::query()->sole()->anchors()->sole();
        $this->assertSame('survive versions', $persisted->exact);
        $this->assertSame($this->version->id, (int) $persisted->document_version_id);
    }

    public function test_an_anchor_that_no_longer_matches_is_refused_by_the_same_capture_path(): void
    {
        // The REST capture path's trust boundary, reached by an agent: `exact` has
        // to really sit at those offsets in the live projection. The refusal
        // carries the same machine code a browser gets, so the agent can tell
        // "re-read the document" from "you are not allowed".
        $anchor = $this->anchorPayload();
        $anchor['exact'] = 'text that was never in this document';
        // A mismatch makes the capture path re-project before it refuses, exactly
        // as it does for a browser — so the web's projection endpoint is faked
        // here for the same reason the REST anchor tests fake it.
        $this->fakeProjection(self::PLAIN_TEXT);

        KedgeServer::actingAs($this->agentFor())
            ->tool(PostCommentTool::class, [
                'document_id' => $this->document->id,
                'body' => 'Stale anchor',
                'anchor' => $anchor,
            ])
            ->assertHasErrors(['anchor_document_changed']);

        $this->assertSame(0, Thread::query()->count());
        $this->assertSame(0, Comment::query()->count());
    }

    public function test_an_anchor_missing_required_selectors_is_rejected_before_the_service(): void
    {
        // The same bounds StoreThreadRequest enforces for a browser.
        KedgeServer::actingAs($this->agentFor())
            ->tool(PostCommentTool::class, [
                'document_id' => $this->document->id,
                'body' => 'Half an anchor',
                'anchor' => ['exact' => 'survive versions'],
            ])
            ->assertHasErrors([]);

        $this->assertSame(0, Thread::query()->count());
    }

    public function test_an_oversized_body_is_rejected(): void
    {
        KedgeServer::actingAs($this->agentFor())
            ->tool(PostCommentTool::class, [
                'document_id' => $this->document->id,
                'body' => str_repeat('a', 20001),
            ])
            ->assertHasErrors([]);

        $this->assertSame(0, Comment::query()->count());
    }

    public function test_an_empty_body_is_rejected(): void
    {
        KedgeServer::actingAs($this->agentFor())
            ->tool(PostCommentTool::class, [
                'document_id' => $this->document->id,
                'body' => '',
            ])
            ->assertHasErrors([]);

        $this->assertSame(0, Comment::query()->count());
    }

    public function test_reply_adds_a_comment_to_an_existing_thread(): void
    {
        $thread = $this->threadOn($this->document, body: 'A human raised this');

        KedgeServer::actingAs($this->agentFor())
            ->tool(ReplyTool::class, [
                'thread_id' => $thread->id,
                'body' => 'Agreed, and here is a counter-example.',
            ])
            ->assertOk()
            ->assertStructuredContent(fn (AssertableJson $json) => $json
                ->where('comment.thread_id', $thread->id)
                ->where('comment.client', 'mcp')
                ->where('comment.author.name', 'Agent Operator')
                ->etc());

        $this->assertSame(2, $thread->comments()->count());
        $this->assertSame(CommentClient::Mcp, $thread->comments()->latest('id')->first()->client);
    }

    public function test_a_supplied_idempotency_key_makes_a_retry_return_the_original(): void
    {
        $agent = $this->agentFor();
        $arguments = [
            'document_id' => $this->document->id,
            'body' => 'Posted once',
            'idempotency_key' => 'agent-run-42',
        ];

        KedgeServer::actingAs($agent)->tool(PostCommentTool::class, $arguments)->assertOk();
        KedgeServer::actingAs($agent)->tool(PostCommentTool::class, $arguments)->assertOk();

        $this->assertSame(1, Thread::query()->count());
        $this->assertSame(1, Comment::query()->count());
    }

    public function test_a_write_into_another_workspace_is_denied_and_persists_nothing(): void
    {
        $stranger = Workspace::create(['name' => 'Stranger', 'slug' => 'stranger']);
        [$foreign] = $this->readyDocument($stranger, 'Not yours');
        $thread = $this->threadOn($foreign);
        $agent = $this->agentFor();

        KedgeServer::actingAs($agent)
            ->tool(PostCommentTool::class, ['document_id' => $foreign->id, 'body' => 'Trespassing'])
            ->assertHasErrors(['No document is available']);

        KedgeServer::actingAs($agent)
            ->tool(ReplyTool::class, ['thread_id' => $thread->id, 'body' => 'Trespassing'])
            ->assertHasErrors(['No thread is available']);

        $this->assertSame(0, Comment::query()->where('client', CommentClient::Mcp->value)->count());
    }

    public function test_every_write_is_audit_logged_with_the_tool_and_the_credential(): void
    {
        $issued = $this->issueToken();
        $agent = $this->operator->fresh()->withAccessToken($issued->accessToken);

        KedgeServer::actingAs($agent)
            ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => 'Audited'])
            ->assertOk();

        $entry = AuditLog::query()->where('action', AuditEvent::McpWrite->value)->sole();
        $this->assertSame('post_comment', $entry->meta['tool']);
        $this->assertSame('mcp', $entry->meta['client']);
        $this->assertSame($issued->accessToken->id, $entry->meta['agent_token_id']);
        $this->assertSame('Claude Code', $entry->meta['agent_token_name']);
        $this->assertSame($this->operator->id, $entry->user_id);
        $this->assertSame($this->workspace->id, $entry->workspace_id);

        // The domain trail the shared service already writes is untouched — the
        // MCP row says who, the domain rows say what.
        $this->assertSame(1, AuditLog::query()->where('action', AuditEvent::ThreadCreated->value)->count());
        $this->assertSame(1, AuditLog::query()->where('action', AuditEvent::CommentCreated->value)->count());
    }

    public function test_the_audit_trail_never_carries_the_token_value(): void
    {
        $issued = $this->issueToken();

        KedgeServer::actingAs($this->operator->fresh()->withAccessToken($issued->accessToken))
            ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => 'Audited'])
            ->assertOk();

        foreach (AuditLog::query()->get() as $entry) {
            $this->assertStringNotContainsString(
                $issued->plainTextToken,
                json_encode($entry->meta ?? []),
            );
        }
    }

    public function test_reads_are_not_audit_logged(): void
    {
        // `mcp.write` is a WRITE trail (user story 20). An agent reading a
        // document is observability, not an auditable act — otherwise a polling
        // agent buries the trail its operator needs.
        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDocumentTool::class, ['document_id' => $this->document->id])
            ->assertOk();

        $this->assertSame(0, AuditLog::query()->where('action', AuditEvent::McpWrite->value)->count());
    }

    public function test_every_tool_call_emits_the_tool_invoked_observability_event(): void
    {
        Log::spy();

        KedgeServer::actingAs($this->agentFor())
            ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => 'Observed'])
            ->assertOk();

        Log::shouldHaveReceived('info')->withArgs(
            fn (string $message, array $context = []): bool => $message === 'mcp.tool_invoked'
                && ($context['tool'] ?? null) === 'post_comment'
                && ($context['write'] ?? null) === true
                && ($context['document_id'] ?? null) === $this->document->id
                && ($context['user_id'] ?? null) === $this->operator->id,
        );
    }

    public function test_a_denied_tool_call_is_still_observed(): void
    {
        // An agent probing documents it cannot reach is exactly what an operator
        // wants in the log; an event that only fired on success would hide it.
        Log::spy();
        $stranger = Workspace::create(['name' => 'Stranger', 'slug' => 'stranger']);
        [$foreign] = $this->readyDocument($stranger, 'Not yours');

        KedgeServer::actingAs($this->agentFor())
            ->tool(GetDocumentTool::class, ['document_id' => $foreign->id])
            ->assertHasErrors(['No document is available']);

        Log::shouldHaveReceived('info')->withArgs(
            fn (string $message, array $context = []): bool => $message === 'mcp.tool_invoked'
                && ($context['tool'] ?? null) === 'get_document'
                && ($context['write'] ?? null) === false,
        );
    }

    public function test_writes_are_rate_limited_per_token(): void
    {
        config(['kedge.mcp.write_rate_per_minute' => 2]);
        $agent = $this->agentFor();

        for ($i = 0; $i < 2; $i++) {
            KedgeServer::actingAs($agent)
                ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => "Comment {$i}"])
                ->assertOk();
        }

        KedgeServer::actingAs($agent)
            ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => 'One too many'])
            ->assertHasErrors(['write allowance']);

        $this->assertSame(2, Comment::query()->count());
    }

    public function test_the_write_budget_is_per_credential_not_per_human(): void
    {
        // Two agents owned by one operator: a runaway one must not starve the
        // other, so the budget is keyed on the token.
        config(['kedge.mcp.write_rate_per_minute' => 1]);
        $first = $this->agentFor();
        $second = $this->agentFor();

        KedgeServer::actingAs($first)
            ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => 'First agent'])
            ->assertOk();
        KedgeServer::actingAs($first)
            ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => 'First agent again'])
            ->assertHasErrors(['write allowance']);

        KedgeServer::actingAs($second)
            ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => 'Second agent'])
            ->assertOk();

        $this->assertSame(2, Comment::query()->count());
    }

    public function test_reads_do_not_spend_the_write_budget(): void
    {
        config(['kedge.mcp.write_rate_per_minute' => 1]);
        $agent = $this->agentFor();

        for ($i = 0; $i < 5; $i++) {
            KedgeServer::actingAs($agent)
                ->tool(ListDocumentsTool::class)
                ->assertOk();
        }

        KedgeServer::actingAs($agent)
            ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => 'Still allowed'])
            ->assertOk();
    }

    public function test_a_denied_write_does_not_spend_the_budget(): void
    {
        // The limiter is spent before the Policy runs, so a denial would
        // otherwise let an unauthorized agent burn a legitimate one's allowance.
        // It cannot: the budget is per token, and this asserts the authorized
        // path still has its full allowance after a denial elsewhere.
        config(['kedge.mcp.write_rate_per_minute' => 2]);
        $stranger = Workspace::create(['name' => 'Stranger', 'slug' => 'stranger']);
        [$foreign] = $this->readyDocument($stranger, 'Not yours');
        $agent = $this->agentFor();

        KedgeServer::actingAs($agent)
            ->tool(PostCommentTool::class, ['document_id' => $foreign->id, 'body' => 'Trespassing'])
            ->assertHasErrors(['No document is available']);

        // One budget unit was spent by the refused attempt; one remains.
        KedgeServer::actingAs($agent)
            ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => 'Legitimate'])
            ->assertOk();

        $this->assertSame(1, Comment::query()->count());
    }

    /**
     * Revocation linearizability — the debt #131 deferred here.
     *
     * Sanctum resolves the bearer once, at authentication. Without a re-check
     * inside the write transaction, a request that authenticated a moment before
     * the operator hit Revoke would still commit its comment afterwards.
     */
    public function test_a_token_revoked_after_authentication_cannot_commit_a_write(): void
    {
        $issued = $this->issueToken();
        $agent = $this->operator->fresh()->withAccessToken($issued->accessToken);

        // The credential is hydrated on $agent — the state an in-flight request
        // is in — and then the row goes away.
        app(AgentTokenService::class)->revoke($issued->accessToken);

        KedgeServer::actingAs($agent)
            ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => 'Too late'])
            ->assertHasErrors(['revoked']);

        $this->assertSame(0, Comment::query()->count());
        $this->assertSame(0, Thread::query()->count());
    }

    public function test_a_revoked_token_cannot_reply_either(): void
    {
        $thread = $this->threadOn($this->document);
        $issued = $this->issueToken();
        $agent = $this->operator->fresh()->withAccessToken($issued->accessToken);

        app(AgentTokenService::class)->revoke($issued->accessToken);

        KedgeServer::actingAs($agent)
            ->tool(ReplyTool::class, ['thread_id' => $thread->id, 'body' => 'Too late'])
            ->assertHasErrors(['revoked']);

        $this->assertSame(1, $thread->comments()->count());
    }

    public function test_the_revocation_check_runs_inside_the_write_transaction(): void
    {
        // A re-read OUTSIDE the transaction would still lose the race: revoke
        // could land between the check and the insert. This asserts the ordering
        // the guarantee rests on — the token row is read, under a transaction,
        // before the thread row is written — on every engine, including the
        // lock-less SQLite the suite runs on.
        $observed = [];
        DB::listen(function ($query) use (&$observed): void {
            $observed[] = [
                'sql' => $query->sql,
                'transaction_level' => DB::transactionLevel(),
            ];
        });

        KedgeServer::actingAs($this->agentFor())
            ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => 'Ordered'])
            ->assertOk();

        $tokenCheck = null;
        $threadInsert = null;
        foreach ($observed as $index => $query) {
            if ($tokenCheck === null && str_contains($query['sql'], 'personal_access_tokens')) {
                $tokenCheck = $index;
                $this->assertGreaterThan(
                    0,
                    $query['transaction_level'],
                    'The agent-token revalidation must run inside the write transaction.',
                );
            }

            if ($threadInsert === null && str_starts_with($query['sql'], 'insert into "threads"')) {
                $threadInsert = $index;
            }
        }

        $this->assertNotNull($tokenCheck, 'No agent-token revalidation query was issued.');
        $this->assertNotNull($threadInsert, 'No thread insert was issued.');
        $this->assertLessThan($threadInsert, $tokenCheck, 'The revalidation must precede the write.');
    }

    /**
     * The two-connection barrier the linearizability claim really rests on:
     * a concurrent revoke must serialize against an in-flight write rather than
     * interleave with it.
     *
     * That needs real row locks, and the suite runs on an in-memory SQLite whose
     * second connection is a different database entirely — so this is gated to a
     * lock-capable engine (`DB_CONNECTION=mysql|pgsql`) rather than faked. The
     * ordering it would prove is asserted lock-free above; what only this can
     * show is that revoke BLOCKS behind the write instead of racing it.
     */
    public function test_a_concurrent_revoke_serializes_behind_an_in_flight_write(): void
    {
        $driver = DB::connection()->getDriverName();

        if (! in_array($driver, ['mysql', 'pgsql'], true)) {
            $this->markTestSkipped(
                "The barrier needs real row locks; [{$driver}] has none. "
                .'Run the suite against MySQL or Postgres to exercise it.'
            );
        }

        $issued = $this->issueToken();
        $agent = $this->operator->fresh()->withAccessToken($issued->accessToken);
        $tokenId = $issued->accessToken->id;

        // Connection A: hold the token row inside a transaction, as a write does.
        DB::beginTransaction();
        app(AgentTokenService::class)->revalidateForWrite($agent);

        // Connection B: a revoke arriving mid-write must not delete the row while
        // A holds it. A short lock wait turns "blocked" into an observable.
        $second = DB::connection(DB::getDefaultConnection());
        $second->statement($driver === 'mysql' ? 'SET SESSION innodb_lock_wait_timeout = 1' : "SET lock_timeout = '1s'");

        $blocked = false;
        try {
            $second->table('personal_access_tokens')->where('id', $tokenId)->delete();
        } catch (\Throwable) {
            $blocked = true;
        }

        DB::rollBack();

        $this->assertTrue($blocked, 'A concurrent revoke must block behind the in-flight write, not interleave.');
        $this->assertNotNull(AgentToken::query()->find($tokenId));
    }

    protected function tearDown(): void
    {
        RateLimiter::clear('mcp-write:1');
        Mockery::close();

        parent::tearDown();
    }
}
