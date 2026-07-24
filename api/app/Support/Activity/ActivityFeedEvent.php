<?php

namespace App\Support\Activity;

use App\Enums\AuditEvent;
use App\Models\AuditLog;
use Carbon\CarbonInterface;

/**
 * One projected activity-feed row — the allowlist projection of decision 3A.
 *
 * This DTO is the single boundary between the raw audit trail and the feed
 * payload: it carries ONLY the fields the feed is allowed to surface (type, the
 * actor's display name, the snapshot sentence fields, a target ref, the
 * timestamp). The row's `ip` and its raw `meta` bag never reach here, so they
 * can never be serialized downstream — the same independent-allowlist discipline
 * as IntegrationResource, and what the serialization test pins.
 *
 * Two allowlists live here in one auditable place: {@see feedEvents()} names the
 * event *types* the feed exposes (a subset of AuditEvent's 41 — only the ones
 * that carry a user-facing sentence), and {@see contextFor()} names, per type,
 * exactly which meta keys are projected into the sentence.
 */
final readonly class ActivityFeedEvent
{
    /**
     * @param  array<string, mixed>  $context  allowlisted snapshot fields only
     */
    private function __construct(
        public int $id,
        public AuditEvent $type,
        public ?string $actorName,
        public array $context,
        public ?ActivityTarget $target,
        public CarbonInterface $createdAt,
    ) {}

    /**
     * The type allowlist: the feed-worthy events, each with a user-facing
     * sentence (M3.8 #111 AC). Everything else in the AuditEvent vocabulary —
     * auth, project CRUD, shares, magic links, integrations, resync start/stop,
     * thread resolve/reopen, comment edit/delete, etc. — stays out of the feed.
     * The write side instrumented exactly these with 2A display snapshots (#108,
     * #110), so each renders from its row alone.
     *
     * `thread.created` is deliberately absent: opening a thread also emits
     * `comment.created` for its first comment, so exposing both would double every
     * new-thread action into two rows. `comment.created` alone covers the user
     * story's "replies" (and thread-opening comments) as one clean line.
     *
     * @return list<AuditEvent>
     */
    public static function feedEvents(): array
    {
        return [
            AuditEvent::CommentCreated,
            AuditEvent::SuggestionAccepted,
            AuditEvent::SuggestionDeclined,
            AuditEvent::ApprovalGiven,
            AuditEvent::ApprovalGoneStale,
            AuditEvent::ReanchorCompleted,
            AuditEvent::DocumentImported,
            AuditEvent::DocumentImportFailed,
            AuditEvent::WorkspaceRenamed,
        ];
    }

    /**
     * @return list<string> the backing values of {@see feedEvents()}
     */
    public static function feedActions(): array
    {
        return array_map(static fn (AuditEvent $event): string => $event->value, self::feedEvents());
    }

    /**
     * Project an audit row into a feed event. The row's `action` is a plain
     * string (the column is un-cast so an older reader tolerates a future case —
     * #108); only allowlisted actions are ever queried, so `tryFrom` resolves.
     */
    public static function fromAuditLog(AuditLog $log, ?ActivityTarget $target): self
    {
        $type = AuditEvent::tryFrom((string) $log->action);
        $meta = is_array($log->meta) ? $log->meta : [];

        return new self(
            id: (int) $log->id,
            type: $type,
            // The actor's name is the frozen snapshot (2A), never a live lookup —
            // present only where the write side captured it (comments, suggestions,
            // approvals granted, imports). System/aggregate rows (re-sync digest,
            // gone-stale, rename) carry none and render without an avatar.
            actorName: self::stringOrNull($meta['actor_name'] ?? null),
            context: self::contextFor($type, $meta),
            target: $target,
            createdAt: $log->created_at,
        );
    }

    /**
     * The per-type snapshot-field allowlist: for each feed type, exactly the meta
     * keys its sentence needs. Anything else in meta (and `ip`) is dropped by
     * omission — this is the projection, so a future meta key can never leak into
     * the payload without being named here.
     *
     * @param  array<string, mixed>  $meta
     * @return array<string, mixed>
     */
    private static function contextFor(AuditEvent $type, array $meta): array
    {
        return match ($type) {
            AuditEvent::CommentCreated,
            AuditEvent::SuggestionAccepted,
            AuditEvent::SuggestionDeclined => self::compact([
                'document_title' => self::stringOrNull($meta['document_title'] ?? null),
                'section' => self::stringOrNull($meta['section'] ?? null),
            ]),

            AuditEvent::ApprovalGiven,
            AuditEvent::DocumentImported => self::compact([
                'document_title' => self::stringOrNull($meta['document_title'] ?? null),
            ]),

            AuditEvent::DocumentImportFailed => self::compact([
                'document_title' => self::stringOrNull($meta['document_title'] ?? null),
                'reason' => self::stringOrNull($meta['reason'] ?? null),
            ]),

            AuditEvent::ApprovalGoneStale => self::compact([
                'document_title' => self::stringOrNull($meta['document_title'] ?? null),
                'count' => self::intOrNull($meta['count'] ?? null),
            ]),

            // The re-sync digest is ONE line (decision 1A / #110): the three counts
            // drive "28 anchored, 2 relocated, 1 orphaned". Counts default to 0 (a
            // present-but-zero outcome), never null, so the sentence always reads.
            AuditEvent::ReanchorCompleted => self::compact([
                'document_title' => self::stringOrNull($meta['document_title'] ?? null),
                'anchored' => (int) ($meta['anchored'] ?? 0),
                'relocated' => (int) ($meta['relocated'] ?? 0),
                'orphaned' => (int) ($meta['orphaned'] ?? 0),
            ]),

            AuditEvent::WorkspaceRenamed => self::compact([
                'workspace_name' => self::stringOrNull($meta['to']['name'] ?? null),
            ]),

            default => [],
        };
    }

    /**
     * Drop null entries but keep a present 0 (re-sync counts) — a plain
     * array_filter would swallow the zeros the digest sentence needs.
     *
     * @param  array<string, mixed>  $fields
     * @return array<string, mixed>
     */
    private static function compact(array $fields): array
    {
        return array_filter($fields, static fn ($value): bool => $value !== null);
    }

    private static function stringOrNull(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }

    private static function intOrNull(mixed $value): ?int
    {
        return is_int($value) || (is_string($value) && ctype_digit($value)) ? (int) $value : null;
    }
}
