<?php

namespace App\Http\Requests;

use App\Enums\ThreadType;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreThreadRequest extends FormRequest
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
            'type' => ['required', Rule::enum(ThreadType::class)],
            'body' => ['required', 'string', 'max:20000'],
            'idempotency_key' => ['required', 'string', 'max:128'],
            'failed_capture' => ['sometimes', 'boolean'],
            'anchor' => ['nullable', 'array'],
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

    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($this->input('type') === ThreadType::Inline->value && ! is_array($this->input('anchor'))) {
                    $validator->errors()->add('anchor', 'Inline threads require an anchor selector.');
                }
            },
        ];
    }
}
