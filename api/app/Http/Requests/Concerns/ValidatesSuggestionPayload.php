<?php

namespace App\Http\Requests\Concerns;

use App\Enums\CommentType;
use Illuminate\Validation\Validator;

trait ValidatesSuggestionPayload
{
    private function validateCommentOrSuggestionPayload(
        Validator $validator,
        CommentType $commentType,
        bool $suggestionsAllowed,
        ?string $anchorExact,
        string $inlineOnlyField,
    ): void {
        if ($commentType === CommentType::Suggestion) {
            if (! $suggestionsAllowed) {
                $validator->errors()->add(
                    $inlineOnlyField,
                    'Suggested edits can only be posted on inline threads with an anchored selection.',
                );
            }

            $proposedText = trim((string) $this->input('proposed_text', ''));
            if ($proposedText === '') {
                $validator->errors()->add('proposed_text', 'Suggested edits require proposed replacement text.');
            } elseif ($anchorExact !== null && $proposedText === trim($anchorExact)) {
                $validator->errors()->add('proposed_text', 'Suggested edits must change the selected text.');
            }

            return;
        }

        if (trim((string) $this->input('body', '')) === '') {
            $validator->errors()->add('body', 'Comments require a body.');
        }

        if ($this->has('proposed_text')) {
            $validator->errors()->add('proposed_text', 'Plain comments cannot include proposed replacement text.');
        }
    }
}
