<?php

namespace App\Http\Requests\Concerns;

use App\Http\Requests\StoreDocumentRequest;
use App\Http\Requests\UpdateDocumentContentRequest;
use Closure;

/**
 * The byte-precise size cap for directly pasted/uploaded content (SPEC §5.1),
 * shared by the two paste seams: the initial import ({@see StoreDocumentRequest})
 * and a later manual content update ({@see UpdateDocumentContentRequest}).
 * One rule so both surfaces enforce the identical storage budget — a cap raised
 * in config moves both at once, and neither can silently drift from the other.
 */
trait CapsPastedContent
{
    /**
     * Byte-precise size cap for pasted content (config-driven). String `max:` counts
     * characters, not bytes, so a multibyte paste could slip past a character cap —
     * this enforces the real storage budget, rejecting the request (422) before any
     * write.
     */
    protected function withinPasteCap(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            $cap = (int) config('kedge.import.max_paste_bytes');

            if (is_string($value) && strlen($value) > $cap) {
                $mb = rtrim(rtrim(number_format($cap / (1024 * 1024), 1), '0'), '.');
                $fail("The pasted content may not be larger than {$mb} MB.");
            }
        };
    }
}
