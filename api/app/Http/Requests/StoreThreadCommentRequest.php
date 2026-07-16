<?php

namespace App\Http\Requests;

use App\Enums\CommentType;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreThreadCommentRequest extends FormRequest
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
            'type' => ['sometimes', Rule::enum(CommentType::class)],
            'body' => ['sometimes', 'string', 'max:20000'],
            'proposed_text' => ['sometimes', 'string', 'max:20000'],
            'idempotency_key' => ['required', 'string', 'max:128'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $type = $this->input('type', CommentType::Comment->value);
                if ($type === CommentType::Suggestion->value) {
                    if (trim((string) $this->input('proposed_text', '')) === '') {
                        $validator->errors()->add('proposed_text', 'Suggested edits require proposed replacement text.');
                    }

                    return;
                }

                if (trim((string) $this->input('body', '')) === '') {
                    $validator->errors()->add('body', 'Comments require a body.');
                }

                if ($this->has('proposed_text')) {
                    $validator->errors()->add('proposed_text', 'Plain comments cannot include proposed replacement text.');
                }
            },
        ];
    }
}
