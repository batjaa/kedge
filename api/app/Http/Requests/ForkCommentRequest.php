<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class ForkCommentRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'title' => ['prohibited'],
            'idempotency_key' => ['required', 'string', 'max:128'],
            'anchor' => ['sometimes', 'nullable', 'array', 'required_array_keys:exact,start,end,projection_version'],
            'anchor.exact' => ['required_with:anchor', 'string', 'max:20000'],
            'anchor.prefix' => ['nullable', 'string', 'max:1000'],
            'anchor.suffix' => ['nullable', 'string', 'max:1000'],
            'anchor.start' => ['required_with:anchor', 'integer', 'min:0'],
            'anchor.end' => ['required_with:anchor', 'integer', 'min:1'],
            'anchor.heading_path' => ['sometimes', 'array'],
            'anchor.heading_path.*' => ['string', 'max:255'],
            'anchor.projection_version' => ['required_with:anchor', 'string', 'max:64'],
        ];
    }
}
