<?php

namespace App\Services\AI\Prompt;

/**
 * Honest coverage accounting (SPEC §14). When a review is too big for the
 * context budget the run chunks by section — and when it is too big even for the
 * chunk ceiling, some of it is left out. Either way the output SAYS SO: the
 * statement below is stored on the run and rendered verbatim by the panel, so
 * truncation is never silent.
 *
 * `unit` is the thing being counted ("threads" for the digest) so later builders
 * can count sections or comments without re-spelling the sentence.
 */
final class Coverage
{
    /**
     * @param  list<string>  $notes  Extra omissions a builder must own up to —
     *                               anything left out that the covered/total
     *                               count alone would not confess.
     */
    public function __construct(
        public readonly int $covered,
        public readonly int $total,
        public readonly bool $chunked,
        public readonly string $unit = 'threads',
        public readonly array $notes = [],
    ) {}

    /**
     * Add an omission to the statement. Builders use this for material that the
     * unit count can't express — a document body left out, a quote shortened —
     * so "covers all N threads" can never be the whole truth by omission.
     */
    public function withNote(string $note): self
    {
        return new self($this->covered, $this->total, $this->chunked, $this->unit, [...$this->notes, $note]);
    }

    public function isPartial(): bool
    {
        return $this->covered < $this->total;
    }

    /**
     * The user-facing sentence. Rendered verbatim — never re-derived in the web.
     */
    public function statement(): string
    {
        return trim(implode(' ', [$this->headline(), ...$this->notes]));
    }

    private function headline(): string
    {
        if ($this->total === 0) {
            return sprintf('No review %s yet — nothing to digest.', $this->unit);
        }

        if ($this->isPartial()) {
            return sprintf(
                'Covers %d of %d %s — the review was too large to read in full.',
                $this->covered,
                $this->total,
                $this->unit,
            );
        }

        return sprintf('Covers all %d %s.', $this->total, $this->unit);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'covered' => $this->covered,
            'total' => $this->total,
            'chunked' => $this->chunked,
            'statement' => $this->statement(),
        ];
    }
}
