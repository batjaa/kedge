<?php

namespace App\Http\Requests;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Validates an import request — either a URL to fetch or content pasted directly
 * (#22), never both. Authorization is a Policy check in the controller (SPEC 13),
 * not here — this only shapes the input. For URLs the `url:http,https` rule is a
 * first, cheap gate; the SSRF guard is the real boundary at fetch time (SPEC 13).
 * For pasted content the byte cap is the real boundary: it rejects the request
 * (422) before any document row is created.
 */
class StoreDocumentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            // Exactly one of url / content: each is required when the other is
            // absent, and url prohibits content so they can't both be sent.
            'url' => ['required_without:content', 'prohibits:content', 'string', 'url:http,https', 'max:2048'],
            'content' => ['required_without:url', 'string', $this->withinPasteCap()],
            'title' => ['nullable', 'string', 'max:255'],
            // Optional target project (the import form on a project page, M3.6).
            // Shape only — the controller resolves it within the workspace and
            // 404s a foreign id (8A).
            'project_id' => ['sometimes', 'nullable', 'integer'],
        ];
    }

    /**
     * Byte-precise size cap for pasted content (config-driven). String `max:` counts
     * characters, not bytes, so a multibyte paste could slip past a character cap —
     * this enforces the real storage budget.
     */
    protected function withinPasteCap(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            $cap = (int) config('kedge.import.max_paste_bytes');

            if (is_string($value) && strlen($value) > $cap) {
                $mb = rtrim(rtrim(number_format($cap / (1024 * 1024), 1), '0'), '.');
                $fail("The pasted content may not be larger than {$mb} MB.");
            }
        };
    }
}
