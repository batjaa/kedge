<?php

namespace App\Http\Requests;

use App\Enums\CommentType;
use App\Enums\ThreadType;
use App\Http\Requests\Concerns\ValidatesSuggestionPayload;
use App\Models\Thread;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreThreadCommentRequest extends FormRequest
{
    use ValidatesSuggestionPayload;

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
            'comment_type' => ['sometimes', Rule::enum(CommentType::class)],
            'body' => ['sometimes', 'string', 'max:20000'],
            'proposed_text' => ['sometimes', 'string', 'max:20000'],
            'idempotency_key' => ['required', 'string', 'max:128'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $thread = $this->thread();
                $commentType = CommentType::tryFrom((string) $this->input('comment_type', CommentType::Comment->value))
                    ?? CommentType::Comment;
                $this->validateCommentOrSuggestionPayload(
                    $validator,
                    $commentType,
                    $thread?->type === ThreadType::Inline,
                    $thread?->type === ThreadType::Inline ? $this->anchorExact($thread) : null,
                    'comment_type',
                );
            },
        ];
    }

    private function thread(): ?Thread
    {
        $thread = $this->route('thread');

        return $thread instanceof Thread ? $thread : null;
    }

    private function anchorExact(Thread $thread): ?string
    {
        $exact = $thread->anchors()->orderBy('start')->value('exact');

        return is_string($exact) ? $exact : null;
    }
}
