<?php

namespace App\Enums;

/**
 * The MCP surface, as a closed vocabulary (SPEC §15, #135).
 *
 * Every tool Kedge exposes to agents names one case here, and the tool-list
 * test asserts the server's registered names are exactly these. That makes the
 * central product guarantee — "approvals and lifecycle changes are human-only,
 * because no MCP tool for them exists" — a structural property of one enum
 * rather than a promise scattered across six classes: adding a tool for
 * approve, lifecycle, resolve, accept/decline suggestion, or share means adding
 * a case here first, which is exactly where a reviewer will see it.
 *
 * The names are the wire contract an agent operator's config depends on, so
 * renaming a value breaks their integration — add cases, never re-spell one.
 * #136 extends this with the two AI-artifact reads (`get_digest`,
 * `get_improve_prompt`); nothing else is coming.
 */
enum McpTool: string
{
    // Read.
    case ListDocuments = 'list_documents';
    case GetDocument = 'get_document';
    case ListThreads = 'list_threads';
    case GetThread = 'get_thread';

    // Write — stamped `client: mcp`, attributed to the token's owner.
    case PostComment = 'post_comment';
    case Reply = 'reply';

    /**
     * Whether invoking this tool can persist anything.
     *
     * Drives the write-only concerns: the per-token write budget and the audit
     * trail entry. Reads are free and logged only as observability events.
     */
    public function isWrite(): bool
    {
        return match ($this) {
            self::PostComment, self::Reply => true,
            default => false,
        };
    }
}
