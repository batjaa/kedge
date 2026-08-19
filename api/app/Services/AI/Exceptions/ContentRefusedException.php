<?php

namespace App\Services\AI\Exceptions;

/**
 * The provider refused to answer on content-policy grounds. Deterministic: the
 * same document and comments will be refused again, so the run fails at once.
 */
class ContentRefusedException extends AiGenerationException
{
    public function code(): string
    {
        return 'content_refused';
    }

    public function userMessage(): string
    {
        return 'Generation was refused for this content. Editing the review and retrying may help.';
    }
}
