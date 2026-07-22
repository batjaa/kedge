<?php

namespace App\Services\TrackedRepos;

use App\Models\Integration;
use App\Models\Workspace;
use App\Services\TrackedRepos\Exceptions\PreviewException;

/**
 * Computes a tracked-repo preview read-only (SPEC §16, M3.6, decisions 2A/4A/9A/
 * 10A): run the shared {@see RepoDiscoveryService} (resolve ref → list tree →
 * pattern ∩ importable allowlist → cap/truncation checks) and then flag overlaps
 * against the workspace's other tracked repos. No persistence, no import — the
 * scan (#93) runs the same discovery, then diffs and imports.
 *
 * Every unusable outcome is an explicit {@see PreviewException} (loud failure,
 * never a silent partial), so a bad glob or a huge repo costs one glance.
 */
class TrackedRepoPreviewService
{
    public function __construct(
        private readonly RepoDiscoveryService $discovery,
    ) {}

    /**
     * @param  Integration|null  $integration  The workspace PAT, or null for a public read (#23).
     */
    public function preview(
        Workspace $workspace,
        ?Integration $integration,
        string $repoUrl,
        ?string $ref,
        string $pathPattern,
    ): TrackedRepoPreview {
        $repo = RepoRef::fromUrl($repoUrl)
            ?? throw PreviewException::unsupportedRepo();

        $cap = (int) config('kedge.tracked_repos.file_cap', 200);

        $discovery = $this->discovery->discover($repo, $ref, $integration?->token(), $pathPattern, $cap);

        return $this->withOverlaps($workspace, $discovery->paths, $discovery->branch, $cap);
    }

    /**
     * Flag each matched path that another tracked repo in the workspace already
     * holds (10A). One query — the workspace's tracked documents whose path is in
     * the matched set — keeps it O(1) round-trips regardless of match count.
     *
     * @param  list<string>  $matched
     */
    private function withOverlaps(Workspace $workspace, array $matched, string $branch, int $cap): TrackedRepoPreview
    {
        $overlapping = $matched === []
            ? []
            : $workspace->documents()
                ->whereNotNull('tracked_repo_id')
                ->whereIn('tracked_path', $matched)
                ->pluck('tracked_path')
                ->all();

        $overlapSet = array_flip($overlapping);

        $files = array_map(
            fn (string $path): array => ['path' => $path, 'overlap' => isset($overlapSet[$path])],
            $matched,
        );

        return new TrackedRepoPreview(
            files: array_values($files),
            ref: $branch,
            overlapCount: count($overlapping),
            cap: $cap,
        );
    }
}
