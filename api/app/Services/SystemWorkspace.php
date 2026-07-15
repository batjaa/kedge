<?php

namespace App\Services;

use App\Models\Document;
use App\Models\Workspace;
use Database\Seeders\DatabaseSeeder;

/**
 * Resolves the one reserved workspace that owns anonymous demo documents
 * (SPEC §10.3, #25).
 *
 * It belongs to no user — it has no `workspace_members` row, so it can never be
 * reached through the workspace-scoped Policies a real account uses. A document
 * lands here for the 48h it lives as a demo, and leaves the moment someone
 * claims it. Membership in *this* workspace is therefore the canonical "is a
 * demo doc" signal ({@see Document::isDemo()}).
 *
 * Identity is a `settings.system` marker, not a slug or a fixed id: user
 * workspaces derive their slug from a display name (a user *could* be named
 * "Kedge System"), but no registration path ever sets `settings.system`, so the
 * marker can never collide. Resolution is memoized per request — `isDemo()` runs
 * on every shared-doc read, and the id must not cost a query each time.
 */
class SystemWorkspace
{
    private const SLUG = 'kedge-system';

    private ?Workspace $resolved = null;

    /**
     * The reserved system workspace, created on first use so a fresh database or
     * a test never has to run a seeder first (production seeds it deterministically
     * via {@see DatabaseSeeder}, which calls straight through here).
     */
    public function resolve(): Workspace
    {
        return $this->resolved ??= Workspace::firstOrCreate(
            ['slug' => self::SLUG],
            ['name' => 'Kedge Demo', 'settings' => ['system' => true]],
        );
    }

    /**
     * The reserved workspace's id — the cheap handle {@see Document::isDemo()}
     * compares against.
     */
    public function id(): int
    {
        return $this->resolve()->id;
    }

    /**
     * Look the workspace up without creating it. Used by the prune command, which
     * must be a no-op on an instance that never ran demo mode (self-hosted) rather
     * than conjure a demo workspace that has no reason to exist there.
     */
    public function find(): ?Workspace
    {
        return $this->resolved ??= Workspace::where('slug', self::SLUG)->first();
    }
}
