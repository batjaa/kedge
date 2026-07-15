<?php

namespace App\Http\Requests;

use App\Enums\ShareVisibility;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rules\Enum;

/**
 * Creating a share link (SPEC 10.2). Both fields are optional: an omitted
 * `visibility` defaults to `link` (the only M1 mode — any other value is
 * rejected here, not silently downgraded), and an omitted `expires_in_days`
 * means the link never expires.
 *
 * Expiry is taken as a day count rather than a client-supplied timestamp so the
 * server owns the clock — no timezone or skew ambiguity crosses the boundary.
 */
class StoreShareRequest extends FormRequest
{
    /**
     * Authorization is handled by the controller via SharePolicy against the
     * route's document; nothing to add here.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'visibility' => ['sometimes', new Enum(ShareVisibility::class)],
            'expires_in_days' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:365'],
        ];
    }

    /**
     * The requested expiry as a concrete timestamp, or null for a link that never
     * expires. Server clock, so there is one source of truth for "expired".
     */
    public function expiresAt(): ?Carbon
    {
        $days = $this->integer('expires_in_days');

        return $days > 0 ? now()->addDays($days) : null;
    }
}
