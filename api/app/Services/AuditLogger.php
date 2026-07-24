<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;
use Throwable;

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

    /**
     * Record an action that is a side effect of an already-committed change, where
     * a failed audit write must never propagate back and fail the primary action
     * (M3.7 decision 11A — the rename lands even if the trail write throws; M3.8's
     * feed reads this event but never gates it). The failure is logged, not thrown;
     * returns null when the write could not be made.
     *
     * @param  array<string, mixed>  $meta
     */
    public function recordSafely(
        Workspace $workspace,
        ?User $actor,
        string $action,
        ?Model $subject = null,
        array $meta = [],
        ?string $ip = null,
    ): ?AuditLog {
        try {
            return $this->record($workspace, $actor, $action, $subject, $meta, $ip);
        } catch (Throwable $e) {
            // The failure handler must itself never throw — a dead log sink can't
            // be allowed to fail the primary action the trail is a side effect of.
            try {
                Log::warning('audit.write_failed', [
                    'action' => $action,
                    'workspace_id' => $workspace->id,
                    'user_id' => $actor?->id,
                    'exception' => $e->getMessage(),
                ]);
            } catch (Throwable) {
                // Swallowed: nothing left to do if even logging is unavailable.
            }

            return null;
        }
    }
}
