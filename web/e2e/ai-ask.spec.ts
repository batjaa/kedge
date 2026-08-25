import { expect, type Locator, type Page, test } from '@playwright/test';
import { FAKE_ASK_ANSWER, FAKE_ASK_FOLLOW_UP_ANSWER } from './ai-fake';
import { AI_DOC } from './fixtures';
import {
  documentTitle,
  importDocumentFromUrl,
  register,
  selectDocumentText,
  threadRail,
  uniqueIdentity,
} from './helpers';

// Ask AI as a conversation (#139, #151) — the journey that pays down the "no
// e2e journey for the ask surface" debt from the #139 branch gate.
//
// Three things are under test, and only the first is about a panel appearing:
//
//  - **The conversation is real.** The scripted fake answers a follow-up
//    DIFFERENTLY from a first question, and it can only tell them apart by the
//    replayed turns in its prompt (see api's FakeAiServiceProvider). So the
//    second assertion below fails if the transcript stops reaching the builder
//    — which a "an answer appeared" assertion could never catch.
//  - **It is client-held page-session state.** Closing and reopening the panel
//    keeps the turns; RELOADING loses them, because nothing about the
//    conversation is persisted and there is no read path to re-attach one.
//  - **It occupies the rail.** The chat replaces the thread rail while open and
//    the rail comes back on close — the occupant rule, asserted where it is
//    visible rather than in a class name.
//
// No live model call is made: the API runs under AI_FAKE_RESPONSES with an
// obviously fake key (e2e/serve-api.sh).

const JOURNEY_TIMEOUT = 180_000;

/** The docked chat panel — the rail occupant, by its landmark label. */
function chatPanel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Ask about this document' });
}

async function askQuestion(page: Page, question: string): Promise<void> {
  const panel = chatPanel(page);
  await panel.getByLabel('Your question', { exact: true }).fill(question);
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
}

test('ask opens a rail chat, answers, carries the conversation into a follow-up, survives reopen, and clears on reload', async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  const author = uniqueIdentity('ai-ask');
  const firstQuestion = `What does this say about re-anchoring? ${author.email}`;
  const followUp = 'And what happens to the offsets?';

  await register(page, author);
  await importDocumentFromUrl(page, AI_DOC.url);
  await expect(documentTitle(page, AI_DOC.title)).toBeVisible();

  // The thread rail owns the column until the chat takes it.
  await expect(threadRail(page)).toBeVisible();
  await expect(chatPanel(page)).toHaveCount(0);

  // ---- Open from a selection ----------------------------------------------
  await selectDocumentText(page, AI_DOC.mcpAnchor);
  await page.locator('div.fixed[role="group"]').getByRole('button', { name: 'Ask AI' }).click();

  const panel = chatPanel(page);
  await expect(panel).toBeVisible();
  // Rail occupancy: the chat REPLACED the thread rail rather than stacking a
  // third column beside it.
  await expect(threadRail(page)).toHaveCount(0);

  // The selection rode along as a removable chip on the next turn, not as text
  // typed into the question.
  await expect(panel.getByText('Selected passage', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Remove the selected passage' })).toBeVisible();

  // ---- First turn ---------------------------------------------------------
  await askQuestion(page, firstQuestion);

  await expect(panel.getByText(firstQuestion, { exact: true })).toBeVisible();
  await expect(panel.getByText(FAKE_ASK_ANSWER, { exact: true })).toBeVisible({ timeout: 60_000 });
  // Spending it consumed the chip; the next question is doc-wide unless a new
  // selection attaches one.
  await expect(panel.getByRole('button', { name: 'Remove the selected passage' })).toHaveCount(0);

  // ---- Follow-up: the conversation actually travels ------------------------
  await askQuestion(page, followUp);

  await expect(panel.getByText(followUp, { exact: true })).toBeVisible();
  // The fake can only produce THIS sentence when the prompt carried prior turns.
  await expect(panel.getByText(FAKE_ASK_FOLLOW_UP_ANSWER, { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  // Turns accumulate — the first answer is still on screen beside the second,
  // which is the whole difference from the modal that replaced it (#139).
  await expect(panel.getByText(FAKE_ASK_ANSWER, { exact: true })).toBeVisible();
  await expect(panel.getByRole('article')).toHaveCount(2);

  // Nothing was written to the review: no thread, no comment, no suggestion
  // (hard rule 5, asserted where a user would see it).
  await expect(panel.getByRole('button', { name: /post|reply|suggest/i })).toHaveCount(0);

  // ---- Close and reopen: the conversation is still there --------------------
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(chatPanel(page)).toHaveCount(0);
  // ...and the thread rail has the column back.
  await expect(threadRail(page)).toBeVisible();

  // Reopen from the header this time — one panel, two ways in.
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  const reopened = chatPanel(page);
  await expect(reopened.getByText(firstQuestion, { exact: true })).toBeVisible();
  await expect(reopened.getByText(FAKE_ASK_ANSWER, { exact: true })).toBeVisible();
  await expect(reopened.getByText(FAKE_ASK_FOLLOW_UP_ANSWER, { exact: true })).toBeVisible();

  // ---- Reload: it is gone --------------------------------------------------
  // The conversation is page-session state and nothing else. There is no
  // conversation table and no latest-ask read, so there is nothing to come back
  // to — and the copy in the panel promises exactly that.
  await page.reload();
  await expect(documentTitle(page, AI_DOC.title)).toBeVisible();
  await expect(chatPanel(page)).toHaveCount(0);
  await expect(page.getByText(FAKE_ASK_ANSWER, { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  const fresh = chatPanel(page);
  await expect(fresh).toBeVisible();
  await expect(fresh.getByRole('article')).toHaveCount(0);
  await expect(fresh.getByText(FAKE_ASK_ANSWER, { exact: true })).toHaveCount(0);
  // An empty conversation offers nothing to clear.
  await expect(fresh.getByRole('button', { name: 'New conversation', exact: true })).toHaveCount(0);
});
