<?php

namespace App\Http\Resources\V1;

use App\Models\AgentToken;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An **Agent Token** as its owner manages it (SPEC §15) — the list and mint
 * responses.
 *
 * The plaintext is absent by default and cannot be resurrected: only its
 * SHA-256 digest is stored, and this resource never reads that column at all.
 * The mint response is the one moment the value exists, attached here by the
 * controller via {@see withPlainTextValue()} — the same one-time idiom as a
 * Share URL.
 *
 * Hand-kept in sync with web/lib/agent-token-types.ts (TS/PHP duplication is
 * accepted debt until OpenAPI codegen — TODOS).
 *
 * @mixin AgentToken
 */
class AgentTokenResource extends JsonResource
{
    /**
     * No "data" envelope — matches the M0/M1 house shape.
     *
     * @var string|null
     */
    public static $wrap = null;

    /**
     * The one-time plaintext. Set only on the mint response; null (and omitted)
     * everywhere else. A declared property, so it is never proxied to the model.
     */
    private ?string $plainTextValue = null;

    public function withPlainTextValue(string $value): static
    {
        $this->plainTextValue = $value;

        return $this;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            // What the operator watches to know their agent is alive — and what
            // makes an unused token obviously safe to revoke.
            'last_used_at' => $this->last_used_at,
            'created_at' => $this->created_at,
            // Present only on the mint response — the sole time the value exists.
            'value' => $this->when($this->plainTextValue !== null, $this->plainTextValue),
        ];
    }
}
