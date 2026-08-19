<?php

namespace App\Policies;

use App\Models\AiRun;
use App\Models\Document;
use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;

/**
 * AI runs are workspace-scoped like the document they read (SPEC §13): an id in
 * a URL is never an access path, so a foreign run id is denied 403 rather than
 * confirmed to exist.
 *
 * Generation is a MEMBER capability, not a reviewer one. A magic-link reviewer
 * can read, comment, suggest, and approve one shared document, but spending the
 * workspace's Anthropic key is not part of that grant — and a reviewer holds no
 * personal workspace, so they are refused 403 here, never a 500. The IDOR matrix
 * pins both rows.
 */
class AiRunPolicy
{
    use AuthorizesWorkspaceMembership;

    /**
     * Read a run — the polling target, and the panel's re-attach on mount.
     *
     * Workspace membership is the floor. A PER-ACTOR run adds a second gate: a
     * reply draft is one person's unposted words in their own voice, and an ask
     * is one person's question and the answer to it (#139) — and run ids are
     * sequential, so without this any member could walk the ledger and read what
     * a colleague was considering saying, or what they were confused about.
     * Shared artifacts — digests, improve-prompts, thread summaries — stay
     * workspace-readable, which is what makes re-attaching to someone else's
     * completed run free.
     */
    public function view(User $user, AiRun $aiRun): bool
    {
        $member = $user->workspaces()
            ->whereKey($aiRun->workspace_id)
            ->exists();

        if (! $member) {
            return false;
        }

        return ! $aiRun->type->isPerActor() || $this->ownedBy($user, $aiRun->created_by);
    }

    /**
     * See this document's runs at all — the panel's re-attach read. Same
     * workspace rule as requesting one: a reviewer who may not spend the key may
     * not read what it produced either.
     */
    public function viewAny(User $user, Document $document): bool
    {
        return $this->memberOf($user, $document);
    }

    /**
     * Request a generation over a document. Same workspace rule as the document's
     * own mutations; share reviewers stay on the share surface.
     */
    public function create(User $user, Document $document): bool
    {
        return $this->memberOf($user, $document);
    }
}
