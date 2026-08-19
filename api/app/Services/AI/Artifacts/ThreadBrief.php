<?php

namespace App\Services\AI\Artifacts;

/**
 * One unresolved thread as the improve-the-doc artifact renders it: where in the
 * document it sits, the text it is anchored to, and the accepted suggested edits
 * it carries.
 *
 * `requiredEdits` holds the reviewers' proposed replacement text EXACTLY as
 * stored — never truncated, never round-tripped through the model. The artifact
 * tells the coding agent to apply those characters, so any shortening here would
 * be a silent rewrite of an edit the author already accepted.
 */
final class ThreadBrief
{
    /**
     * @param  string  $section  Heading path ('Anchoring > Budget'), or '' for a
     *                           document-level thread with no place in the outline.
     * @param  string|null  $quote  The anchored text, or null when the thread is
     *                              document-level or its anchor did not survive.
     * @param  list<string>  $requiredEdits  Accepted suggested edits, verbatim.
     */
    public function __construct(
        public readonly int $id,
        public readonly string $section,
        public readonly ?string $quote,
        public readonly array $requiredEdits = [],
    ) {}
}
