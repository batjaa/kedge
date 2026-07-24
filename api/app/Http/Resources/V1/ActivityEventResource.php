<?php

namespace App\Http\Resources\V1;

use App\Support\Activity\ActivityFeedEvent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One activity-feed row as the dashboard renders it (M3.8 #111, decision 3A).
 *
 * The projection is already done upstream: the wrapped {@see ActivityFeedEvent}
 * holds ONLY allowlisted fields, so `ip` and the raw `meta` bag cannot appear
 * here — this resource just shapes them for the wire. The web composes the
 * sentence from `type` + `context` + `actor`, escaping the (untrusted) snapshot
 * strings on render, and links to `target` only when one resolved. Mirrors the
 * IntegrationResource allowlist discipline; the serialization test pins it.
 *
 * @mixin ActivityFeedEvent
 */
class ActivityEventResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type->value,
            // Name only — no live user lookup, no avatar URL (2A: render from the
            // snapshot). The web derives initials; a null name is a system row.
            'actor' => ['name' => $this->actorName],
            // Cast to object so an (unusual) empty context serializes as {} not [].
            'context' => (object) $this->context,
            'target' => $this->target?->toArray(),
            'created_at' => $this->createdAt,
        ];
    }
}
