<?php

namespace App\Http\Resources\V1;

use App\Models\Integration;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A connected integration as its workspace manages it (SPEC §16) — the masked
 * list and create responses.
 *
 * The credential never appears here. This is an explicit allowlist: only the
 * provider, the last-4 hint, and timestamps — enough to recognize and manage a
 * connection, nothing to use it with. Even the create response (right after the
 * token was submitted) returns only the mask, never the token back (SPEC §13).
 *
 * Hand-kept in sync with web/lib/integration-types.ts (TS/PHP duplication is
 * accepted debt until OpenAPI codegen — TODOS).
 *
 * @mixin Integration
 */
class IntegrationResource extends JsonResource
{
    /**
     * No "data" envelope — matches the M0/M1 house shape.
     *
     * @var string|null
     */
    public static $wrap = null;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'provider' => $this->provider->value,
            // The only hint we ever surface — never the token itself.
            'token_last_four' => $this->tokenLastFour(),
            'created_at' => $this->created_at,
        ];
    }
}
