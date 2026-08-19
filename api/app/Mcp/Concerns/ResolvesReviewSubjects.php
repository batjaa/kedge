<?php

namespace App\Mcp\Concerns;

use App\Enums\McpTool;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Thread;
use App\Models\User;
use App\Policies\ThreadPolicy;
use App\Services\Agents\Exceptions\McpToolException;
use Closure;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;

/**
 * The shared spine of every MCP tool (SPEC §15, #135): resolve a subject,
 * authorize it through the SAME Policy the REST route uses, and hand the tool a
 * model. Tools stay thin adapters with zero business logic — the spec's word
 * for them — and no tool author can accidentally skip the Gate, because
 * resolution and authorization are the same call.
 */
trait ResolvesReviewSubjects
{
    /**
     * The acting principal: the human who minted the token. Agent comments carry
     * their owner's identity plus the agent badge — nobody reviews anonymously.
     */
    protected function agent(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new McpToolException('This tool requires an authenticated agent token.');
        }

        return $user;
    }

    /**
     * Run a tool body: emit its observability event, then translate the one
     * exception type that carries an agent-safe message into an error result.
     *
     * The event fires on INVOCATION, before authorization — an agent probing
     * documents it cannot reach is exactly the activity an operator wants in the
     * log, and a event that only fired on success would hide it (SPEC §19).
     *
     * @param  array<string, mixed>  $context
     * @param  Closure():(Response|ResponseFactory)  $callback
     */
    protected function invokeTool(
        McpTool $tool,
        Request $request,
        array $context,
        Closure $callback,
    ): Response|ResponseFactory {
        $token = $request->user()?->currentAccessToken();

        try {
            Log::info('mcp.tool_invoked', [
                'tool' => $tool->value,
                'write' => $tool->isWrite(),
                'user_id' => $request->user()?->getAuthIdentifier(),
                'agent_token_id' => $token?->getKey(),
                'agent_token_name' => $token?->name,
                ...$context,
            ]);
        } catch (\Throwable) {
            // A dead log channel must never fail a review action (the audit
            // logger's own stance, applied to the observability event).
        }

        try {
            return $callback();
        } catch (McpToolException $e) {
            return Response::error($e->getMessage());
        }
    }

    /**
     * A document this token may act on, or an indistinguishable refusal.
     *
     * "Not found" and "not yours" are deliberately ONE answer here, unlike REST's
     * 404/403 split: document ids are globally sequential, and an agent token is
     * a long-lived credential an operator hands to third-party software — an
     * enumeration oracle on that surface is worth closing even though the
     * equivalent human endpoint keeps the split for its UI. The Policy is
     * unchanged and still the only thing that decides; only the wording of the
     * denial is unified.
     */
    protected function documentFor(mixed $id, string $ability): Document
    {
        $document = Document::query()->whereKey($this->identifier($id, 'document_id'))->first();

        if ($document === null || Gate::denies($ability, $document)) {
            throw new McpToolException("No document is available at id [{$id}] for this agent token.");
        }

        return $document;
    }

    /**
     * The same rule for a document reached through a Thread-class ability
     * (`viewAny`, `create`), which Laravel passes as `[Thread::class, $document]`.
     */
    protected function documentForThreadAbility(mixed $id, string $ability): Document
    {
        return $this->documentForClassAbility($id, $ability, Thread::class);
    }

    /**
     * A document reached through a CLASS-level ability — the shape Laravel uses
     * when the ability has no instance yet (`[Thread::class, $document]`,
     * `[AiRun::class, $document]`), and the shape the equivalent REST controller
     * passes to `authorize()`.
     *
     * One resolver rather than one per policy class, so the refusal wording and
     * the not-found/not-yours unification below can never differ between tools.
     *
     * @param  class-string  $class
     */
    protected function documentForClassAbility(mixed $id, string $ability, string $class): Document
    {
        $document = Document::query()->whereKey($this->identifier($id, 'document_id'))->first();

        if ($document === null || Gate::denies($ability, [$class, $document])) {
            throw new McpToolException("No document is available at id [{$id}] for this agent token.");
        }

        return $document;
    }

    /**
     * A thread this token may act on, authorized through {@see ThreadPolicy}.
     */
    protected function threadFor(mixed $id, string $ability): Thread
    {
        $thread = Thread::query()->whereKey($this->identifier($id, 'thread_id'))->first();

        if ($thread === null) {
            throw new McpToolException("No thread is available at id [{$id}] for this agent token.");
        }

        $thread->loadMissing('document');

        $denied = $ability === 'viewAny'
            ? Gate::denies('viewAny', [Thread::class, $thread->document])
            : Gate::denies($ability, $thread);

        if ($denied) {
            throw new McpToolException("No thread is available at id [{$id}] for this agent token.");
        }

        return $thread;
    }

    /**
     * The `version_id` argument, resolved through the DOCUMENT'S OWN relation so
     * a version id belonging to another document is simply not there — never an
     * access path, and never a cross-document read.
     *
     * Every tool that can be pinned to a version takes the same argument under
     * the same name and resolves it here, because the alternative is drift:
     * `get_document(version_id)` handing an agent v1's projection while
     * `post_comment` silently anchors the offsets it computed from it to v2 —
     * which, when both versions happen to contain the same text at the same
     * place, is a wrong anchor nobody would ever notice.
     *
     * Null means "the document's current version", exactly as omitting
     * `document_version_id` does on REST.
     */
    protected function requestedVersion(mixed $value, Document $document): ?DocumentVersion
    {
        if ($value === null) {
            return null;
        }

        $version = $document->versions()
            ->whereKey($this->identifier($value, 'version_id'))
            ->first();

        if (! $version instanceof DocumentVersion) {
            throw new McpToolException("This document has no version with id [{$value}].");
        }

        return $version;
    }

    /**
     * Pagination arguments, clamped exactly as every REST list endpoint clamps
     * them (SPEC §17, G11): page ≥ 1, per_page in 1..50.
     *
     * @return array{int, int}
     */
    protected function pageArguments(Request $request): array
    {
        $page = max(1, (int) $request->get('page', 1));
        $perPage = min(max((int) $request->get('per_page', 20), 1), 50);

        return [$page, $perPage];
    }

    /**
     * A positive integer id, or a refusal — never a silent cast. `"12abc"` and
     * `-1` are the agent's bug, and saying so beats resolving id 12 or 404ing on
     * a negative row that could never exist.
     */
    private function identifier(mixed $value, string $field): int
    {
        if (is_int($value) && $value > 0) {
            return $value;
        }

        if (is_string($value) && ctype_digit($value) && (int) $value > 0) {
            return (int) $value;
        }

        throw new McpToolException("The [{$field}] argument must be a positive integer id.");
    }
}
