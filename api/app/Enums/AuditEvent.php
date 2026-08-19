<?php

namespace App\Enums;

use App\Services\AuditLogger;

/**
 * The single vocabulary of audit-trail event types (SPEC 9, 10.1).
 *
 * Every write through {@see AuditLogger} names one of these cases —
 * the seam is typed to this enum, so a bare magic string can never reach the
 * `audit_logs.action` column (M3.8 #108: "only enum'd types are ever written").
 *
 * This enum is the contract M5's inbox consumes and M3.8's activity feed reads a
 * subset of: the feed's read side (#111) allowlists the cases that carry a
 * user-facing sentence rather than shrinking this vocabulary. Because downstream
 * consumers key off the backing VALUES, renaming a value is a data migration —
 * add new cases, never re-spell an existing one.
 */
enum AuditEvent: string
{
    // Authentication & onboarding.
    case UserRegistered = 'user.registered';
    case UserGithubLinked = 'user.github_linked';

    // Workspace lifecycle.
    case WorkspaceCreated = 'workspace.created';
    case WorkspaceRenamed = 'workspace.renamed';

    // Projects.
    case ProjectCreated = 'project.created';
    case ProjectUpdated = 'project.updated';

    // Demo documents.
    case DemoCreated = 'demo.created';
    case DemoClaimed = 'demo.claimed';

    // Document import & lifecycle.
    case DocumentImportRequested = 'document.import_requested';
    case DocumentImportRetried = 'document.import_retried';
    case DocumentImported = 'document.imported';
    case DocumentImportFailed = 'document.import_failed';
    case DocumentProjectAssigned = 'document.project_assigned';
    case LifecycleChanged = 'lifecycle.changed';

    // Re-sync & re-anchor.
    case ResyncStarted = 'resync.started';
    case ResyncCompleted = 'resync.completed';
    case ResyncFailed = 'resync.failed';
    case ReanchorCompleted = 'reanchor.completed';

    // Tracked repositories.
    case TrackedRepoCreated = 'tracked_repo.created';
    case TrackedRepoDeleted = 'tracked_repo.deleted';
    case TrackedRepoScanned = 'tracked_repo.scanned';

    // Sharing, magic links & participants.
    case ShareCreated = 'share.created';
    case ShareRevoked = 'share.revoked';
    case MagicLinkSent = 'magiclink.sent';
    case MagicLinkSendFailed = 'magiclink.send_failed';
    case ParticipantVerified = 'participant.verified';

    // Integrations.
    case IntegrationConnected = 'integration.connected';
    case IntegrationRemoved = 'integration.removed';

    // Agent tokens (SPEC §15).
    case AgentTokenCreated = 'agent_token.created';
    case AgentTokenRevoked = 'agent_token.revoked';

    // MCP writes (SPEC §15, user story 20). One row per write TOOL call,
    // alongside the domain events the shared comment service already records:
    // `comment.created` says what happened, this says an agent did it, through
    // which tool, on which credential. Reads are observability events only —
    // an agent reading a document is not an auditable act.
    case McpWrite = 'mcp.write';

    // Approvals.
    case ApprovalGiven = 'approval.given';
    case ApprovalRevoked = 'approval.revoked';
    case ApprovalGoneStale = 'approval.gone_stale';

    // Comments, threads & suggestions.
    case ThreadCreated = 'thread.created';
    case ThreadResolved = 'thread.resolved';
    case ThreadReopened = 'thread.reopened';
    case ThreadForked = 'thread.forked';
    case CommentCreated = 'comment.created';
    case CommentEdited = 'comment.edited';
    case CommentDeleted = 'comment.deleted';
    case SuggestionAccepted = 'suggestion.accepted';
    case SuggestionDeclined = 'suggestion.declined';
    case SuggestionReopened = 'suggestion.reopened';
}
