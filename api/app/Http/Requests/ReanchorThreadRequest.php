<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class ReanchorThreadRequest extends FormRequest
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
            'anchor' => ['required', 'array'],
            'anchor.exact' => ['required', 'string', 'max:20000'],
            'anchor.prefix' => ['nullable', 'string', 'max:1000'],
            'anchor.suffix' => ['nullable', 'string', 'max:1000'],
            'anchor.start' => ['required', 'integer', 'min:0'],
            'anchor.end' => ['required', 'integer', 'min:1'],
            'anchor.heading_path' => ['sometimes', 'array'],
            'anchor.heading_path.*' => ['string', 'max:255'],
            'anchor.projection_version' => ['required', 'string', 'max:64'],
        ];
    }
}
