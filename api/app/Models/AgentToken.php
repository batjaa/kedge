<?php

namespace App\Models;

use App\Policies\AgentTokenPolicy;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Attributes\UsePolicy;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * An **Agent Token** (CONTEXT.md, SPEC §15): the named, revocable,
 * workspace-scoped credential a member mints for one agent.
 *
 * Physically it is a Sanctum personal access token — same table, same hashing,
 * same `findToken()` — registered as Sanctum's model in AppServiceProvider so
 * the domain name reaches the code, Policy discovery finds
 * {@see AgentTokenPolicy}, and `$user->currentAccessToken()`
 * hands back something that knows what a workspace is.
 *
 * Its scope rides in `abilities` as a single `workspace:{id}` entry, checked by
 * the shared Policy membership trait on every authorization — never per tool
 * (m4-ai-agents eng review §2). The plaintext exists exactly once, in the
 * response to the mint call; only its SHA-256 digest is ever stored.
 */
// The domain name is Kedge's; the table and the Policy are named explicitly
// because neither follows from it — the rows are Sanctum's, and Policy discovery
// would otherwise only guess for a model whose name matches its Policy's.
#[Table('personal_access_tokens')]
#[UsePolicy(AgentTokenPolicy::class)]
class AgentToken extends PersonalAccessToken
{
    /**
     * The one ability that grants an agent token reach into a workspace.
     */
    public static function workspaceAbility(int $workspaceId): string
    {
        return 'workspace:'.$workspaceId;
    }

    /**
     * Whether this token may act inside the given workspace.
     *
     * Deliberately an exact-membership test rather than Sanctum's `can()`: `can()`
     * honours a `*` wildcard, and a wildcard token would be an unscoped one —
     * exactly the thing workspace scoping exists to make impossible. Kedge never
     * mints `*`, and this makes a stray one harmless rather than total.
     */
    public function scopedToWorkspace(int $workspaceId): bool
    {
        return in_array(static::workspaceAbility($workspaceId), (array) $this->abilities, true);
    }
}
