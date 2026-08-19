<?php

namespace App\Services\AI\Split;

use App\Models\Anchor;
use App\Models\DocumentVersion;
use App\Models\Thread;

/**
 * Turns a model's verbatim quote into a persistable anchor payload (M4 #134).
 *
 * The model proposes TEXT; this class computes OFFSETS. That division is
 * deliberate: a language model asked for character offsets is being asked to be
 * a tokenizer, and a wrong offset is an anchor silently pointing at the wrong
 * sentence. Here the quote is located in the live projection or it yields no
 * anchor at all.
 *
 * Two rules bound what a proposal may point at:
 *
 *  1. Offsets are UTF-16 code units, the unit the capture path and
 *     `CommentThreadService::validatedAnchor()` agree on. A payload built here
 *     is shaped exactly like a browser-captured selection, so it crosses the
 *     same trust boundary at fork time with no special case.
 *  2. The search is BOUNDED to the source thread's anchored span. A split of a
 *     thread stays inside the passage that thread is about — the model cannot
 *     move the conversation to a different part of the document by quoting it.
 */
final class SplitAnchorLocator
{
    /** Context carried either side of the quote, in codepoints. */
    private const CONTEXT_CHARS = 32;

    /** Matches the fork request's `anchor.exact` ceiling. */
    private const MAX_QUOTE_CHARS = 20000;

    /** How many repeats of the thread's passage are weighed before giving up on the tie-break. */
    private const MAX_OCCURRENCES_SCANNED = 32;

    /**
     * @param  list<string>  $headingPath
     */
    private function __construct(
        private readonly string $plainText,
        private readonly int $spanStart,
        private readonly int $spanEnd,
        private readonly array $headingPath,
        private readonly string $projectionVersion,
    ) {}

    /**
     * A locator for the span this thread is anchored to on the given version, or
     * null when there is no span to search — a document-level thread, a version
     * with no projection, or an anchor whose text no longer appears in the
     * document at all. Every one of those means "propose no anchors", never
     * "propose a guess".
     */
    public static function forThread(Thread $thread, ?DocumentVersion $version): ?self
    {
        $plainText = (string) ($version?->plain_text ?? '');
        $projectionVersion = (string) ($version?->projection_version ?? '');

        if ($plainText === '' || $projectionVersion === '') {
            return null;
        }

        $anchor = $thread->anchors
            ->firstWhere('document_version_id', $version?->id)
            ?? $thread->anchors->last();

        if (! $anchor instanceof Anchor) {
            return null;
        }

        $exact = (string) $anchor->exact;

        if ($exact === '') {
            return null;
        }

        $spanStart = self::spanStart($plainText, $exact, (int) $anchor->start);

        if ($spanStart === null) {
            return null;
        }

        return new self(
            plainText: $plainText,
            spanStart: $spanStart,
            spanEnd: $spanStart + mb_strlen($exact, 'UTF-8'),
            headingPath: array_values(array_filter((array) ($anchor->heading_path ?? []), 'is_string')),
            projectionVersion: $projectionVersion,
        );
    }

    /**
     * Where the thread's passage sits in the live projection, in codepoints.
     *
     * Located by TEXT, not by the stored offsets: a relocated anchor's persisted
     * start/end belong to the version it was captured against. But when a
     * document repeats a passage verbatim, "the first occurrence" is a coin
     * flip — so among the occurrences we prefer the one whose UTF-16 start still
     * matches what the anchor recorded, and only fall back to the first when
     * none does.
     *
     * The scan is capped: a thread may legitimately be anchored to three
     * characters, and re-measuring every occurrence of "the" in a long document
     * is quadratic work for a tie-break that stopped mattering after the first
     * handful. Past the cap the first occurrence wins, which is where this
     * started.
     */
    private static function spanStart(string $plainText, string $exact, int $storedStart): ?int
    {
        $offset = mb_strpos($plainText, $exact, 0, 'UTF-8');

        if ($offset === false) {
            return null;
        }

        $first = $offset;

        for ($scanned = 0; $offset !== false && $scanned < self::MAX_OCCURRENCES_SCANNED; $scanned++) {
            $utf16Start = intdiv(
                strlen((string) mb_convert_encoding(mb_substr($plainText, 0, $offset, 'UTF-8'), 'UTF-16LE', 'UTF-8')),
                2,
            );

            if ($utf16Start === $storedStart) {
                return $offset;
            }

            $offset = mb_strpos($plainText, $exact, $offset + 1, 'UTF-8');
        }

        return $first;
    }

    /**
     * The anchor payload for one proposed quote, or null when the quote is not
     * verbatim text from the thread's passage — a paraphrase, a hallucination,
     * or an attempt to point somewhere else in the document.
     *
     * @return array{exact: string, prefix: string, suffix: string, start: int, end: int, heading_path: list<string>, projection_version: string}|null
     */
    public function locate(string $quote): ?array
    {
        $quote = trim($quote);

        if ($quote === '' || mb_strlen($quote, 'UTF-8') > self::MAX_QUOTE_CHARS) {
            return null;
        }

        $span = mb_substr($this->plainText, $this->spanStart, $this->spanEnd - $this->spanStart, 'UTF-8');
        $offset = mb_strpos($span, $quote, 0, 'UTF-8');

        if ($offset === false) {
            return null;
        }

        $startChars = $this->spanStart + $offset;
        $endChars = $startChars + mb_strlen($quote, 'UTF-8');
        $start = $this->utf16Length(mb_substr($this->plainText, 0, $startChars, 'UTF-8'));

        return [
            'exact' => $quote,
            'prefix' => mb_substr(
                $this->plainText,
                max(0, $startChars - self::CONTEXT_CHARS),
                min(self::CONTEXT_CHARS, $startChars),
                'UTF-8',
            ),
            'suffix' => mb_substr($this->plainText, $endChars, self::CONTEXT_CHARS, 'UTF-8'),
            'start' => $start,
            'end' => $start + $this->utf16Length($quote),
            'heading_path' => $this->headingPath,
            'projection_version' => $this->projectionVersion,
        ];
    }

    /**
     * Length in UTF-16 code units — the unit anchors are stored and validated
     * in, so an astral character costs two here exactly as it does in the
     * browser's selection API.
     */
    private function utf16Length(string $value): int
    {
        return intdiv(strlen((string) mb_convert_encoding($value, 'UTF-16LE', 'UTF-8')), 2);
    }
}
