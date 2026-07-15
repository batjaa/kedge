<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Validates an anonymous demo import (SPEC §10.3, #25). Only a URL is accepted —
 * demo mode is public-connectors-only, so there is no `content` paste path and no
 * PAT. The `url:http,https` rule is a cheap first gate; the SSRF guard is the real
 * boundary at fetch time (SPEC §13), and the controller narrows the matched
 * connector to the public allowlist.
 *
 * No `authorize()` gate here beyond the always-true default: the surface itself
 * is unauthenticated, edition-gated by the `demo.enabled` middleware and
 * rate-limited per IP.
 */
class StoreDemoDocumentRequest extends FormRequest
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
            'url' => ['required', 'string', 'url:http,https', 'max:2048'],
        ];
    }
}
