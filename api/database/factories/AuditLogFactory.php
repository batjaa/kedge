<?php

namespace Database\Factories;

use App\Enums\AuditEvent;
use App\Models\AuditLog;
use App\Models\Workspace;
use App\Services\AuditLogger;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Model;

/**
 * @extends Factory<AuditLog>
 *
 * Seeds append-only audit rows for the activity-feed tests (M3.8 #111). Real
 * write sites go through {@see AuditLogger}; this factory exists so
 * tests can pin an event's action, meta snapshot, subject, `ip`, and timestamp
 * directly — including the fields the 3A serialization test proves never leak.
 */
class AuditLogFactory extends Factory
{
    protected $model = AuditLog::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'workspace_id' => Workspace::factory(),
            'user_id' => null,
            'action' => AuditEvent::CommentCreated->value,
            'subject_type' => null,
            'subject_id' => null,
            'meta' => null,
            'ip' => null,
            'created_at' => now(),
        ];
    }

    public function action(AuditEvent $event): static
    {
        return $this->state(['action' => $event->value]);
    }

    /**
     * @param  array<string, mixed>  $meta
     */
    public function withMeta(array $meta): static
    {
        return $this->state(['meta' => $meta]);
    }

    public function subject(Model $subject): static
    {
        return $this->state([
            'subject_type' => $subject->getMorphClass(),
            'subject_id' => $subject->getKey(),
        ]);
    }

    public function ip(string $ip): static
    {
        return $this->state(['ip' => $ip]);
    }
}
