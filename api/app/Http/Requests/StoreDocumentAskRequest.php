<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * One reader's question about a document, the passage they had selected when
 * they asked it, and the conversation it continues (SPEC §14, user story 23 —
 * M4 #139, multi-turn since #151).
 *
 * The question is free-form by design: the whole feature is "ask what you
 * actually want to know". Free-form is not unbounded, though —
 * {@see self::MAX_QUESTION_CHARS} is a hard ceiling on what one request can push
 * into a model call, so a scripted client cannot turn the ask endpoint into a
 * way to send a novel through the workspace's key one request at a time.
 * `throttle:ai` bounds the rate; this bounds the size.
 *
 * **The transcript is client-supplied, and that is the design** (#151). The
 * server holds no conversation state: there is no conversation table, no
 * `parent_run_id`, and no read path that could hand one actor another's turns.
 * A follow-up therefore arrives carrying the prior turns the asker's own page is
 * showing. That makes the transcript exactly as untrusted as the document —
 * anyone who can POST here can write any "previous answer" they like — so it is
 * bounded here and fenced as quoted data in the builder, never replayed as a
 * privileged voice.
 *
 * No field is trusted. The question is the reader's own words, the quote is the
 * document's, the transcript is whatever the client sent; all of them reach the
 * model only inside the shared foundation's nonce fence, labeled as data
 * (SPEC §13). Nothing here is ever persisted as review content — an ask has no
 * write path at all.
 */
class StoreDocumentAskRequest extends FormRequest
{
    /**
     * The longest question one ask may carry. Generous for a real question —
     * several sentences with a pasted snippet — and far short of an essay.
     */
    public const MAX_QUESTION_CHARS = 1000;

    /**
     * How many prior turns one follow-up may replay (#151).
     *
     * Eight is a conversation, not an archive: past it the earliest turns have
     * almost always been superseded by later ones, and every replayed turn is
     * budget the document itself no longer gets. The client drops the oldest
     * turns from the REQUEST while its panel keeps showing them, so a long
     * conversation degrades by forgetting its beginning rather than by failing.
     */
    public const MAX_TRANSCRIPT_TURNS = 8;

    /**
     * The whole transcript's character ceiling, across every replayed turn.
     *
     * The turn count alone is not a size bound — eight turns of 20,000-character
     * answers is a 160,000-character prompt. This is the bound that matters,
     * and it is deliberately of the same order as the context budget's own
     * ceiling so a maximal transcript costs the document context (predictably,
     * reported as coverage) rather than overflowing the budget.
     */
    public const MAX_TRANSCRIPT_CHARS = 16000;

    /**
     * Deepest heading path a quoted passage may carry.
     *
     * Six is the deepest heading level a document has, and the capture walks
     * one entry per level — so this is generous. It is a HARD limit rather than
     * a tidy one: the heading path is repeated into the prompt context, which
     * every chunk carries and which the context budget subtracts rather than
     * chunks, so an unbounded path is a way to push arbitrary text at the
     * provider (and into `ai_runs.request`) that the question's own ceiling
     * would not catch.
     */
    public const MAX_HEADING_PATH_DEPTH = 12;

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
            'quote.heading_path' => ['sometimes', 'array', 'max:'.self::MAX_HEADING_PATH_DEPTH],
            'quote.heading_path.*' => ['string', 'max:255'],
            // The conversation so far, oldest first. Each turn is one question
            // the asker put and the answer they were shown; the client sends
            // only turns that actually have an answer, so there is no
            // half-a-turn shape to reason about here.
            'transcript' => ['sometimes', 'nullable', 'array', 'max:'.self::MAX_TRANSCRIPT_TURNS],
            'transcript.*' => ['array'],
            'transcript.*.question' => ['required', 'string', 'max:'.self::MAX_TRANSCRIPT_CHARS],
            'transcript.*.answer' => ['required', 'string', 'max:'.self::MAX_TRANSCRIPT_CHARS],
        ];
    }

    /**
     * The size bound the per-field rules cannot express: the transcript's TOTAL
     * cost, summed across every turn.
     *
     * Without it, eight turns each just inside the per-field ceiling would be a
     * 256,000-character prompt assembled from a payload every individual rule
     * called valid.
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $turns = $this->input('transcript');

                if (! is_array($turns) || $turns === []) {
                    return;
                }

                $total = 0;

                foreach ($turns as $turn) {
                    if (! is_array($turn)) {
                        continue;
                    }

                    foreach (['question', 'answer'] as $field) {
                        $value = $turn[$field] ?? null;

                        if (is_string($value)) {
                            $total += mb_strlen($value);
                        }
                    }
                }

                if ($total > self::MAX_TRANSCRIPT_CHARS) {
                    $validator->errors()->add(
                        'transcript',
                        'The conversation is too long to replay. Start a new conversation.',
                    );
                }
            },
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

        $transcript = $this->transcriptPayload();

        if ($transcript !== []) {
            $payload['transcript'] = $transcript;
        }

        return $payload;
    }

    /**
     * The prior turns, reduced to the two fields a replay needs.
     *
     * Anything else the client attached to a turn — a run id, a timestamp, a
     * coverage statement — is dropped rather than stamped onto the run: it would
     * be unverified client data masquerading as ledger fact, and nothing in the
     * prompt needs it.
     *
     * @return list<array{question: string, answer: string}>
     */
    private function transcriptPayload(): array
    {
        $turns = $this->validated('transcript');

        if (! is_array($turns)) {
            return [];
        }

        $payload = [];

        foreach ($turns as $turn) {
            if (! is_array($turn)) {
                continue;
            }

            $question = $turn['question'] ?? null;
            $answer = $turn['answer'] ?? null;

            if (! is_string($question) || ! is_string($answer)) {
                continue;
            }

            $payload[] = ['question' => $question, 'answer' => $answer];
        }

        return $payload;
    }
}
