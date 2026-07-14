<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Validates the paste-a-URL import request. Authorization is a Policy check in
 * the controller (SPEC 13), not here — this only shapes the input. The
 * `url:http,https` rule is a first, cheap gate; the SSRF guard is the real
 * boundary at fetch time (SPEC 13).
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
            'url' => ['required', 'string', 'url:http,https', 'max:2048'],
        ];
    }
}
