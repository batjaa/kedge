<?php

namespace App\Providers;

use App\Services\AI\Agents\CommentSplitAgent;
use App\Services\AI\Agents\DocumentAskAgent;
use App\Services\AI\Agents\ImprovePromptAgent;
use App\Services\AI\Agents\ReplyDraftAgent;
use App\Services\AI\Agents\ReviewDigestAgent;
use App\Services\AI\Agents\ThreadSummaryAgent;
use Illuminate\Support\ServiceProvider;

/**
 * The E2E seam for AI generation (M4 #137): every agent answers from a scripted,
 * deterministic fake instead of the provider.
 *
 * The Playwright journey pack drives the whole AI surface — digest,
 * improve-the-doc prompt, reply drafts, thread summaries, comment splits, asks —
 * against a SERVED api. That rules out the in-process `Agent::fake()` the
 * PHPUnit suites use (module spec, Testing Decisions §1): there is no test
 * process to call it from. So the fake is wired here, at boot, exactly the way
 * `GITHUB_API_HOST` points the tracked-repo journey at a loopback fixture
 * server instead of GitHub.
 *
 * **It cannot leak.** `kedge.ai.fake` is double-gated (see config/kedge.php): an
 * explicit `AI_FAKE_RESPONSES` flag AND `APP_ENV` of `e2e` or `testing`. On any
 * real deployment this provider registers nothing and the SDK reaches the real
 * provider as usual — the flag in a production `.env` is inert. Nothing else in
 * the application reads `kedge.ai.fake`, so this file is the entire blast
 * radius.
 *
 * **The responses are scripted, not random.** `laravel/ai`'s fake will happily
 * auto-generate a payload from an agent's JSON schema when it has no scripted
 * response — which would make every journey assertion about AI content a
 * coin flip. Each agent below is faked with a CLOSURE (never a fixed array), so
 * a chunked run's second and third calls are scripted too rather than falling
 * through to generated data.
 *
 * Two of the six read their prompt, because their output has to line up with
 * real database state for the journey to mean anything:
 *
 *  - the improve-the-doc prompt returns one instruction per thread id it was
 *    actually given (the generator DISCARDS instructions for threads it did not
 *    send, so a fixed id would silently produce an artifact with no
 *    instructions in it);
 *  - the reply draft echoes the stance the author picked, so a journey that
 *    clicks "Push back" and gets an accepting draft fails.
 */
class FakeAiServiceProvider extends ServiceProvider
{
    /**
     * The two passages a scripted split proposal quotes.
     *
     * They are verbatim substrings of the sentence the `ai-split` journey
     * anchors its comment to — see `AI_DOC.splitAnchor` in
     * web/e2e/fixtures.ts, which is the other half of this contract. The
     * generator locates a quote inside the SOURCE THREAD's anchored passage or
     * proposes no anchor at all, so these strings and that fixture sentence
     * must stay in step; the journey fails loudly if they drift.
     */
    public const SPLIT_QUOTE_ONE = 'the anchor must survive a re-import';

    public const SPLIT_QUOTE_TWO = 'the digest is only ever a draft';

    /** Titles the split panel renders, asserted by the `ai-split` journey. */
    public const SPLIT_TITLE_ONE = 'Anchor survival on re-import';

    public const SPLIT_TITLE_TWO = 'The digest stays a draft';

    /** A theme title the `mcp-agent` journey reads out of the digest panel. */
    public const DIGEST_THEME_TITLE = 'Anchoring is the moat';

    /** Prefix of every scripted improve-the-doc instruction. */
    public const IMPROVE_INSTRUCTION_PREFIX = 'Revise the anchored passage so thread';

    /** The thread-summary sentences the `ai-triage` journey asserts. */
    public const SUMMARY_CURRENT_STATE = 'The thread has settled on keeping the anchor, with the wording still open.';

    public const SUMMARY_OPEN_QUESTION = 'Who writes the worked example?';

    /** The scripted ask answer (#139). */
    public const ASK_ANSWER = 'The document says the anchor is re-resolved against the new version, not recreated.';

    public function boot(): void
    {
        if (! config('kedge.ai.fake')) {
            return;
        }

        $this->fakeDigest();
        $this->fakeImprovePrompt();
        $this->fakeReplyDraft();
        $this->fakeThreadSummary();
        $this->fakeCommentSplit();
        $this->fakeDocumentAsk();
    }

    /**
     * Four populated categories, so the digest panel renders every section it
     * has. The coverage line the journey asserts alongside these is computed
     * from the REAL review, not from here.
     */
    private function fakeDigest(): void
    {
        ReviewDigestAgent::fake(fn (): array => [
            'themes' => [[
                'title' => self::DIGEST_THEME_TITLE,
                'summary' => 'Reviewers keep returning to whether comments survive a new version.',
            ]],
            'contention_points' => [[
                'title' => 'How much context an anchor carries',
                'summary' => 'One reviewer wants more prefix and suffix; another says the quote is enough.',
            ]],
            'consensus' => [[
                'title' => 'Drafts are never posted',
                'summary' => 'Everyone agrees an AI output is a draft a person confirms.',
            ]],
            'action_items' => [[
                'title' => 'Add a worked anchoring example',
                'summary' => 'Show one selection surviving a re-import, offsets and all.',
            ]],
        ]);
    }

    /**
     * One instruction per thread the run actually sent. Thread ids come from the
     * assembled prompt because the generator drops any id it did not send — a
     * hard-coded id would produce an artifact with no instructions and a journey
     * asserting an empty string.
     */
    private function fakeImprovePrompt(): void
    {
        ImprovePromptAgent::fake(fn (string $prompt): array => [
            'changes' => array_map(
                fn (int $threadId): array => [
                    'thread_id' => $threadId,
                    'instruction' => self::IMPROVE_INSTRUCTION_PREFIX.' '.$threadId.' is addressed.',
                ],
                $this->threadIdsIn($prompt),
            ),
        ]);
    }

    /**
     * A draft that names the stance it was asked for. The stance travels in the
     * task block ("- PUSH BACK: ..."), so echoing it proves the author's choice
     * reached the model rather than the panel just filling the composer.
     */
    private function fakeReplyDraft(): void
    {
        ReplyDraftAgent::fake(fn (string $prompt): array => [
            'body' => 'Drafted reply ('.$this->stanceIn($prompt).'): I have read the thread and this is where I land.',
        ]);
    }

    private function fakeThreadSummary(): void
    {
        ThreadSummaryAgent::fake(fn (): array => [
            'current_state' => self::SUMMARY_CURRENT_STATE,
            'open_question' => self::SUMMARY_OPEN_QUESTION,
        ]);
    }

    /**
     * Two proposals, each quoting a different half of the journey's anchored
     * sentence — so approving both produces two forked threads with two
     * DIFFERENT anchors, which is what the `ai-split` journey exists to prove.
     */
    private function fakeCommentSplit(): void
    {
        CommentSplitAgent::fake(fn (): array => [
            'splits' => [
                [
                    'title' => self::SPLIT_TITLE_ONE,
                    'fragment' => 'The anchor has to survive a re-import.',
                    'quote' => self::SPLIT_QUOTE_ONE,
                ],
                [
                    'title' => self::SPLIT_TITLE_TWO,
                    'fragment' => 'And the digest must stay a draft nobody posts automatically.',
                    'quote' => self::SPLIT_QUOTE_TWO,
                ],
            ],
        ]);
    }

    /**
     * A single grounded answer. Scripted like the rest so no agent is left
     * unfaked in an environment that has no key to fall back on — an ask reached
     * from any journey answers deterministically rather than erroring.
     */
    private function fakeDocumentAsk(): void
    {
        DocumentAskAgent::fake(fn (): array => ['answer' => self::ASK_ANSWER]);
    }

    /**
     * Thread ids as the improve-prompt builder writes them into its fenced
     * thread blocks ("thread id: 42").
     *
     * @return list<int>
     */
    private function threadIdsIn(string $prompt): array
    {
        preg_match_all('/^thread id: (\d+)$/m', $prompt, $matches);

        return array_values(array_unique(array_map('intval', $matches[1])));
    }

    /**
     * The stance line the reply-draft builder put in the task block, as the
     * words a person picked in the UI.
     */
    private function stanceIn(string $prompt): string
    {
        return match (true) {
            str_contains($prompt, '- PUSH BACK:') => 'push back',
            str_contains($prompt, '- CLARIFY:') => 'clarify',
            str_contains($prompt, '- ACCEPT:') => 'accept',
            default => 'unknown stance',
        };
    }
}
