<?php

namespace App\Support\Activity;

/**
 * The navigable target of an activity-feed row (M3.8 #111, decision 2A). Resolved
 * from the audit row's morph subject purely to build the link the web renders —
 * never to source the sentence, which comes from the frozen meta snapshot. When
 * the subject (or its owning document) has since been deleted, no target is
 * produced and the row renders its sentence with the link dropped, not the row.
 */
final readonly class ActivityTarget
{
    private function __construct(
        public string $type,
        public ?int $id = null,
    ) {}

    /** A document the row points at (`/documents/{id}` on the web). */
    public static function document(int $id): self
    {
        return new self('document', $id);
    }

    /** The workspace itself (its settings page) — a rename's only target. */
    public static function workspace(): self
    {
        return new self('workspace');
    }

    /**
     * @return array{type: string, id?: int}
     */
    public function toArray(): array
    {
        return $this->id === null
            ? ['type' => $this->type]
            : ['type' => $this->type, 'id' => $this->id];
    }
}
