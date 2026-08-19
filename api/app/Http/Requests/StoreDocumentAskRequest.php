<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * One reader's question about a document, plus the passage they had selected
 * when they asked it (SPEC §14, user story 23 — M4 #139).
 *
 * The question is free-form by design: the whole feature is "ask what you
 * actually want to know". Free-form is not unbounded, though —
 * {@see self::MAX_QUESTION_CHARS} is a hard ceiling on what one request can push
 * into a model call, so a scripted client cannot turn the ask endpoint into a
 * way to send a novel through the workspace's key one request at a time.
 * `throttle:ai` bounds the rate; this bounds the size.
 *
 * Neither field is trusted. The question is the reader's own words and the quote
 * is the document's, and both reach the model only inside the shared foundation's
 * nonce fence, labeled as data (SPEC §13). Nothing here is ever persisted as
 * review content — an ask has no write path at all.
 */
class StoreDocumentAskRequest extends FormRequest
{
    /**
     * The longest question one ask may carry. Generous for a real question —
     * several sentences with a pasted snippet — and far short of an essay.
     */
    public const MAX_QUESTION_CHARS = 1000;

    /**
     * Authorization is the controller's Policy call, as everywhere else in v1.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * The selected passage arrives in the shape the M2 selection capture already
     * produces, so the web hands over the object it built for commenting rather
     * than a second, bespoke one. Only the two fields an ANSWER needs are read:
     * the text and where it sits. Offsets and the projection version are
     * accepted and ignored — an ask persists no anchor and re-anchors nothing,
     * so there is nothing for them to be checked against, and demanding them
     * would make a stale page fail to ask a question it can perfectly well
     * answer.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'question' => ['required', 'string', 'max:'.self::MAX_QUESTION_CHARS],
            'quote' => ['sometimes', 'nullable', 'array'],
            'quote.exact' => ['required_with:quote', 'string', 'max:20000'],
            'quote.heading_path' => ['sometimes', 'array'],
            'quote.heading_path.*' => ['string', 'max:255'],
        ];
    }

    /**
     * Trim first, then validate — so a question of nothing but whitespace is
     * rejected as missing rather than queued as a blank prompt the model would
     * answer from thin air.
     */
    protected function prepareForValidation(): void
    {
        if (is_string($this->input('question'))) {
            $this->merge(['question' => trim($this->input('question'))]);
        }
    }

    /**
     * The request content stamped on the run, and the ONLY thing the queued job
     * reads back — so the job can never see a field this class did not validate.
     *
     * @return array<string, mixed>
     */
    public function askPayload(): array
    {
        $payload = ['question' => (string) $this->validated('question')];

        $quote = $this->validated('quote');

        if (is_array($quote) && is_string($quote['exact'] ?? null)) {
            $payload['quote'] = [
                'exact' => $quote['exact'],
                'heading_path' => array_values(array_filter(
                    (array) ($quote['heading_path'] ?? []),
                    'is_string',
                )),
            ];
        }

        return $payload;
    }
}
