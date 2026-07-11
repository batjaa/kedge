<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Database\Eloquent\Model;

/**
 * Writes the append-only audit trail (SPEC 9, 10.1).
 *
 * Established at registration (M0) so every later module extends this one
 * seam instead of retrofitting audit writes.
 */
class AuditLogger
{
    /**
     * Record an action in the workspace's audit trail.
     *
     * @param  array<string, mixed>  $meta
     */
    public function record(
        Workspace $workspace,
        ?User $actor,
        string $action,
        ?Model $subject = null,
        array $meta = [],
        ?string $ip = null,
    ): AuditLog {
        return AuditLog::create([
            'workspace_id' => $workspace->id,
            'user_id' => $actor?->id,
            'action' => $action,
            'subject_type' => $subject?->getMorphClass(),
            'subject_id' => $subject?->getKey(),
            'meta' => $meta === [] ? null : $meta,
            'ip' => $ip,
        ]);
    }
}
