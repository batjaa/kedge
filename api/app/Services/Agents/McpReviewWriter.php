<?php

namespace App\Services\Agents;

use App\Enums\AuditEvent;
use App\Enums\CommentClient;
use App\Enums\McpTool;
use App\Enums\ThreadType;
use App\Models\Comment;
use App\Models\Document;
use App\Models\Thread;
use App\Models\User;
use App\Services\Agents\Exceptions\McpToolException;
use App\Services\AuditLogger;
use App\Services\Comments\CommentThreadService;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * The one place an agent's words become rows (SPEC §15, #135).
 *
 * The two MCP write tools are thin adapters over this, and this is a thin
 * adapter over {@see CommentThreadService} — the SAME service the human REST
 * endpoints call. Nothing about how a thread is created, how an anchor is
 * validated, how idempotency dedupes, or how the audit trail is written is
 * re-implemented here; if it were, the two paths would drift, and "agents review
 * through the same code as people" would quietly stop being true.
 *
 * What this class adds is the four things that are true of an agent write and
 * of no human one:
 *
 *   1. **The MCP stamp.** `client: mcp` on every comment — which is what lights
 *      the dormant violet `AGENT · MCP` badge with zero web work. Authorship
 *      stays the token's OWNER: the human who minted the credential owns what
 *      their agent says.
 *   2. **A write budget.** One POST endpoint carries reads and writes alike, so
 *      the route limiter cannot tell them apart; the tighter per-token write
 *      allowance is spent here (SPEC §13, user story 21).
 *   3. **Revocation that means it.** The token row is re-read FOR UPDATE inside
 *      the write transaction, so a credential revoked mid-flight cannot commit.
 *   4. **A trail that names the agent.** The domain events (`thread.created`,
 *      `comment.created`) already fire from the shared service; this adds one
 *      `mcp.write` row naming the tool and the token, so "what have the agents
 *      been doing" is one query rather than an inference from `client`.
 */
class McpReviewWriter
{
    public function __construct(
        private readonly CommentThreadService $threads,
        private readonly AgentTokenService $tokens,
        private readonly AuditLogger $audit,
        private readonly McpPayload $payload,
    ) {}

    /**
     * `post_comment` — start a thread on a document, anchored or document-level.
     *
     * @param  array<string, mixed>  $arguments  the tool's validated arguments
     * @return array<string, mixed>
     */
    public function postComment(Document $document, User $agent, array $arguments, ?string $ip): array
    {
        $this->spendWriteBudget($agent);

        $anchor = $arguments['anchor'] ?? null;

        [$thread] = $this->guarded($agent, fn (callable $guard): array => $this->threads->create(
            $document,
            $agent,
            [
                // An anchor makes it an inline thread; without one it hangs off
                // the document — exactly the REST rule (StoreThreadRequest).
                'type' => is_array($anchor) ? ThreadType::Inline->value : ThreadType::Document->value,
                'body' => (string) $arguments['body'],
                'anchor' => $anchor,
                'idempotency_key' => $this->idempotencyKey($arguments),
                'client' => CommentClient::Mcp,
            ],
            $ip,
            $guard,
        ));

        $this->recordWrite(McpTool::PostComment, $document, $agent, $thread, $ip);

        return $this->payload->thread($thread);
    }

    /**
     * `reply` — add a comment to an existing thread.
     *
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    public function reply(Thread $thread, User $agent, array $arguments, ?string $ip): array
    {
        $this->spendWriteBudget($agent);
        $thread->loadMissing('document');

        [$comment] = $this->guarded($agent, fn (callable $guard): array => $this->threads->reply(
            $thread,
            $agent,
            [
                'body' => (string) $arguments['body'],
                'idempotency_key' => $this->idempotencyKey($arguments),
                'client' => CommentClient::Mcp,
            ],
            $ip,
            $guard,
        ));

        $this->recordWrite(McpTool::Reply, $thread->document, $agent, $comment, $ip);

        return $this->payload->comment($comment);
    }

    /**
     * Run a write with the token revalidation closure threaded into its
     * transaction, translating the shared service's HTTP-shaped refusals into
     * something an agent can read.
     *
     * The refusals matter: the anchor trust boundary answers a browser with a
     * 422 carrying a machine code (`anchor_document_changed`,
     * `document_not_ready`, `demo_document_unclaimed`). Over MCP that would
     * surface as "An internal server error occurred." — the agent would retry
     * the same doomed call forever instead of re-reading the document. So the
     * code and the message are handed through verbatim.
     *
     * @template TResult
     *
     * @param  callable(callable():void):TResult  $write
     * @return TResult
     */
    private function guarded(User $agent, callable $write): mixed
    {
        $guard = function () use ($agent): void {
            $this->tokens->revalidateForWrite($agent);
        };

        try {
            return $write($guard);
        } catch (AuthenticationException $e) {
            throw new McpToolException($e->getMessage(), previous: $e);
        } catch (HttpResponseException $e) {
            throw new McpToolException($this->refusalMessage($e), previous: $e);
        } catch (HttpExceptionInterface $e) {
            // `abort(404)` from the version resolver and friends: say what
            // happened without echoing an internal exception message.
            throw new McpToolException(
                'The write was refused ('.$e->getStatusCode().'). Re-read the document and try again.',
                previous: $e,
            );
        }
    }

    /**
     * The per-token write allowance (SPEC §13). Keyed on the CREDENTIAL, not the
     * human: one runaway agent must not starve its operator's other agents, and
     * two agents sharing an owner should not share a budget.
     */
    private function spendWriteBudget(User $agent): void
    {
        $perMinute = max(1, (int) config('kedge.mcp.write_rate_per_minute', 30));
        $key = 'mcp-write:'.($agent->currentAccessToken()?->getKey() ?? 'user:'.$agent->id);

        $allowed = RateLimiter::attempt($key, $perMinute, static fn (): bool => true, 60);

        if ($allowed === false) {
            throw new McpToolException(sprintf(
                'This agent token has used its write allowance (%d per minute). Retry in %d seconds.',
                $perMinute,
                RateLimiter::availableIn($key),
            ));
        }
    }

    /**
     * One audit row per MCP write, naming the tool and the credential (user
     * story 20). Written through `recordSafely`, never `record`: the comment has
     * already committed by the time we are here, and comment persistence must
     * never depend on the trail (AGENTS.md hard rule 6).
     *
     * The token's NAME is recorded, never its value — the plaintext exists once,
     * at mint, and never reaches a log or a trail.
     */
    private function recordWrite(McpTool $tool, Document $document, User $agent, Comment|Thread $subject, ?string $ip): void
    {
        $token = $agent->currentAccessToken();
        $document->loadMissing('workspace');

        $this->audit->recordSafely(
            $document->workspace,
            $agent,
            AuditEvent::McpWrite,
            $subject,
            [
                'tool' => $tool->value,
                'client' => CommentClient::Mcp->value,
                'document_id' => (int) $document->id,
                'agent_token_id' => $token?->getKey(),
                'agent_token_name' => $token?->name,
            ],
            $ip,
        );
    }

    /**
     * Idempotency is the agent's to opt into: a supplied key makes a retried
     * tool call return the ORIGINAL comment instead of writing a second one
     * (the REST contract, verbatim). Agents that do not supply one get a fresh
     * key per call, so an un-keyed retry duplicates — which is honest, and
     * documented on the tool.
     *
     * @param  array<string, mixed>  $arguments
     */
    private function idempotencyKey(array $arguments): string
    {
        $key = trim((string) ($arguments['idempotency_key'] ?? ''));

        return $key !== '' ? $key : (string) Str::uuid();
    }

    private function refusalMessage(HttpResponseException $e): string
    {
        $decoded = json_decode((string) $e->getResponse()->getContent(), true);
        $body = is_array($decoded) ? $decoded : [];

        $message = is_string($body['message'] ?? null)
            ? $body['message']
            : 'The write was refused.';
        $code = is_string($body['code'] ?? null) ? $body['code'] : null;

        return $code === null ? $message : $message.' ['.$code.']';
    }
}
