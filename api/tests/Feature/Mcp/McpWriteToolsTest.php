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
use App\Services\Comments\CommentThreadService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
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
        // Authorization runs in the tool, before the writer is reached at all, so
        // a refused call costs the agent nothing: its full allowance survives.
        // Otherwise an agent that fat-fingered a document id would be locked out
        // of the review it does have access to.
        config(['kedge.mcp.write_rate_per_minute' => 2]);
        $stranger = Workspace::create(['name' => 'Stranger', 'slug' => 'stranger']);
        [$foreign] = $this->readyDocument($stranger, 'Not yours');
        $agent = $this->agentFor();

        KedgeServer::actingAs($agent)
            ->tool(PostCommentTool::class, ['document_id' => $foreign->id, 'body' => 'Trespassing'])
            ->assertHasErrors(['No document is available']);

        foreach (['First', 'Second'] as $body) {
            KedgeServer::actingAs($agent)
                ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => $body])
                ->assertOk();
        }

        $this->assertSame(2, Comment::query()->count());
    }

    public function test_an_idempotency_key_is_scoped_to_the_token_that_used_it(): void
    {
        // Two agents, one operator. The shared resolver dedupes on (author, scope,
        // key) and both agents ARE that author, so an un-namespaced key would hand
        // the second agent the first's comment and silently drop its own words.
        $first = $this->agentFor();
        $second = $this->agentFor();

        KedgeServer::actingAs($first)->tool(PostCommentTool::class, [
            'document_id' => $this->document->id,
            'body' => 'First agent, run 1',
            'idempotency_key' => 'run-1',
        ])->assertOk();

        KedgeServer::actingAs($second)->tool(PostCommentTool::class, [
            'document_id' => $this->document->id,
            'body' => 'Second agent, run 1',
            'idempotency_key' => 'run-1',
        ])->assertOk()->assertSee('Second agent, run 1');

        $this->assertSame(2, Comment::query()->count());
        $this->assertSame(
            ['First agent, run 1', 'Second agent, run 1'],
            Comment::query()->orderBy('id')->pluck('body_md')->all(),
        );
    }

    public function test_an_agent_key_never_collides_with_a_humans(): void
    {
        // The same operator's browser and agent, same obvious key, same document.
        $agent = $this->agentFor();

        [$human] = app(CommentThreadService::class)->create(
            $this->document,
            $this->operator,
            ['type' => 'document', 'body' => 'Typed by hand', 'idempotency_key' => 'run-1'],
            null,
        );

        KedgeServer::actingAs($agent)->tool(PostCommentTool::class, [
            'document_id' => $this->document->id,
            'body' => 'Posted by the agent',
            'idempotency_key' => 'run-1',
        ])->assertOk()->assertSee('Posted by the agent');

        $this->assertSame(2, Thread::query()->count());
        $this->assertNotSame($human->id, Thread::query()->latest('id')->first()->id);
    }

    public function test_post_comment_anchors_against_the_version_the_agent_read(): void
    {
        // The drift this closes: an agent reads v1, computes offsets from ITS
        // plain_text, and posts. Without pinning, the capture path validates
        // against the CURRENT version — either a spurious rejection, or (when both
        // versions happen to carry the same text at the same place) an anchor
        // silently attached to the wrong version.
        $older = $this->document->versions()->create([
            'kind' => 'mainline',
            'content_raw' => '# Old',
            'content_normalized' => '# Old',
            'content_hash' => hash('sha256', 'older-'.$this->document->id),
            'plain_text' => self::PLAIN_TEXT,
            'projection_version' => (string) config('kedge.projection.current_version'),
        ]);

        KedgeServer::actingAs($this->agentFor())
            ->tool(PostCommentTool::class, [
                'document_id' => $this->document->id,
                'version_id' => $older->id,
                'body' => 'Raised against the version I read.',
                'anchor' => $this->anchorPayload(),
            ])
            ->assertOk();

        $this->assertSame((int) $older->id, (int) Thread::query()->sole()->anchors()->sole()->document_version_id);
    }

    public function test_post_comment_refuses_a_version_belonging_to_another_document(): void
    {
        [, $foreignVersion] = $this->readyDocument($this->workspace, 'Another document');

        KedgeServer::actingAs($this->agentFor())
            ->tool(PostCommentTool::class, [
                'document_id' => $this->document->id,
                'version_id' => $foreignVersion->id,
                'body' => 'Cross-document version',
            ])
            ->assertHasErrors(['has no version with id']);

        $this->assertSame(0, Thread::query()->count());
    }

    public function test_a_suggested_edit_is_refused_rather_than_silently_downgraded(): void
    {
        // Proposing replacement text is the front half of an accept/decline
        // decision that has no MCP tool. Saying so beats dropping the field and
        // letting the agent believe it filed a suggestion.
        KedgeServer::actingAs($this->agentFor())
            ->tool(PostCommentTool::class, [
                'document_id' => $this->document->id,
                'body' => 'Replace this',
                'proposed_text' => 'With this',
                'anchor' => $this->anchorPayload(),
            ])
            ->assertHasErrors([]);

        $this->assertSame(0, Comment::query()->count());
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

    public function test_the_revocation_check_runs_locked_inside_the_write_transaction(): void
    {
        // A re-read OUTSIDE the transaction would still lose the race: revoke
        // could land between the check and the insert. This asserts the ordering
        // the guarantee rests on — the token row is read, under a DEEPER
        // transaction than the ambient one, before the thread row is written —
        // on every engine, including the lock-less SQLite the suite runs on.
        //
        // The token is minted BEFORE the listener is armed, so its INSERT can
        // never be mistaken for the revalidation SELECT; and the baseline
        // transaction level is captured because RefreshDatabase already holds one,
        // which would make a bare "level > 0" assertion vacuous.
        $agent = $this->agentFor();
        $baseline = DB::transactionLevel();

        $observed = [];
        DB::listen(function ($query) use (&$observed): void {
            $observed[] = [
                'sql' => $query->sql,
                'transaction_level' => DB::transactionLevel(),
            ];
        });

        KedgeServer::actingAs($agent)
            ->tool(PostCommentTool::class, ['document_id' => $this->document->id, 'body' => 'Ordered'])
            ->assertOk();

        $selects = [];
        $threadInsert = null;
        foreach ($observed as $index => $query) {
            $sql = strtolower($query['sql']);

            if (str_starts_with($sql, 'select') && str_contains($sql, 'personal_access_tokens')) {
                $selects[$index] = $query;
            }

            if ($threadInsert === null && str_starts_with($sql, 'insert into "threads"')) {
                $threadInsert = $index;
            }
        }

        $this->assertNotNull($threadInsert, 'No thread insert was issued.');
        $this->assertNotEmpty($selects, 'No agent-token revalidation query was issued.');

        // The locked re-read: strictly deeper than the ambient test transaction,
        // and strictly before the row it is protecting.
        $guarded = array_filter(
            $selects,
            fn (array $query, int $index): bool => $query['transaction_level'] > $baseline && $index < $threadInsert,
            ARRAY_FILTER_USE_BOTH,
        );

        $this->assertNotEmpty(
            $guarded,
            'The agent-token revalidation must run inside the write transaction, before the insert.',
        );
    }

    public function test_a_revoked_token_cannot_replay_an_idempotency_key(): void
    {
        // The idempotency fast path returns BEFORE the in-transaction guard, so
        // without the pre-flight check a revoked credential could still be handed
        // an existing comment — and an mcp.write recorded for a write that never
        // happened.
        $issued = $this->issueToken();
        $agent = $this->operator->fresh()->withAccessToken($issued->accessToken);
        $arguments = [
            'document_id' => $this->document->id,
            'body' => 'Posted once',
            'idempotency_key' => 'agent-run-42',
        ];

        KedgeServer::actingAs($agent)->tool(PostCommentTool::class, $arguments)->assertOk();
        $auditRows = AuditLog::query()->where('action', AuditEvent::McpWrite->value)->count();

        app(AgentTokenService::class)->revoke($issued->accessToken);

        KedgeServer::actingAs($agent)
            ->tool(PostCommentTool::class, $arguments)
            ->assertHasErrors(['revoked']);

        $this->assertSame(
            $auditRows,
            AuditLog::query()->where('action', AuditEvent::McpWrite->value)->count(),
            'A revoked replay must not add an mcp.write row.',
        );
    }

    public function test_a_revoked_token_cannot_trigger_a_projection_refresh(): void
    {
        // Anchor validation re-projects (and PERSISTS the projection) when a
        // selector fails to match. That is a write, so a revoked credential must
        // not reach it: the pre-flight check refuses first, and the web's
        // projection endpoint is never called.
        Http::fake();
        $anchor = $this->anchorPayload();
        $anchor['exact'] = 'text that was never in this document';

        $issued = $this->issueToken();
        $agent = $this->operator->fresh()->withAccessToken($issued->accessToken);
        app(AgentTokenService::class)->revoke($issued->accessToken);

        KedgeServer::actingAs($agent)
            ->tool(PostCommentTool::class, [
                'document_id' => $this->document->id,
                'body' => 'Stale anchor from a dead credential',
                'anchor' => $anchor,
            ])
            ->assertHasErrors(['revoked']);

        Http::assertNothingSent();
    }

    /**
     * The two-connection barrier the linearizability claim really rests on:
     * a concurrent revoke must serialize against an in-flight write rather than
     * interleave with it.
     *
     * That needs real row locks AND two real connections, and the suite runs on
     * an in-memory SQLite where a second connection is a different database
     * entirely — so this is gated to a lock-capable engine
     * (`DB_CONNECTION=mysql|pgsql`) rather than faked. The ordering it would
     * prove is asserted lock-free above; what only this can show is that revoke
     * BLOCKS behind the write instead of racing it.
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

        // A genuinely separate connection — its own PDO, not the cached default
        // one, which would share the transaction and prove nothing.
        $barrier = DB::connectUsing(
            'mcp_barrier',
            config('database.connections.'.config('database.default')),
        );
        $barrier->statement($driver === 'mysql' ? 'SET SESSION innodb_lock_wait_timeout = 1' : "SET lock_timeout = '1s'");

        // Connection A: hold the token row inside a transaction, as a write does.
        DB::beginTransaction();
        app(AgentTokenService::class)->revalidateForWrite($agent);

        $blocked = false;
        try {
            $barrier->table('personal_access_tokens')->where('id', $tokenId)->delete();
        } catch (\Throwable) {
            $blocked = true;
        }

        DB::rollBack();
        $barrier->disconnect();

        $this->assertTrue($blocked, 'A concurrent revoke must block behind the in-flight write, not interleave.');
        $this->assertNotNull(AgentToken::query()->find($tokenId));
    }

    protected function tearDown(): void
    {
        Mockery::close();

        parent::tearDown();
    }
}
