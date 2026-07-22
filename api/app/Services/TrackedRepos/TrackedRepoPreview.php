<?php

namespace App\Services\TrackedRepos;

/**
 * A successful preview (SPEC §16, M3.6, story 8): the files a scan would import
 * — the pattern match intersected with the importable-format allowlist — each
 * flagged with whether it overlaps a path already held by another tracked repo in
 * the workspace (10A, so overlapping globs can't silently mint duplicate docs).
 * Read-only: computed, never persisted. The over-cap and truncation failures are
 * {@see Exceptions\DiscoveryException}s, not this object.
 */
final class TrackedRepoPreview
{
    /**
     * @param  list<array{path: string, overlap: bool}>  $files  Sorted matched files.
     */
    public function __construct(
        public readonly array $files,
        public readonly string $ref,
        public readonly int $overlapCount,
        public readonly int $cap,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'ref' => $this->ref,
            'cap' => $this->cap,
            'count' => count($this->files),
            'overlap_count' => $this->overlapCount,
            'files' => $this->files,
        ];
    }
}
