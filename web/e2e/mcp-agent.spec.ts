import { expect, test } from '@playwright/test';
import { FAKE_DIGEST_THEME, FAKE_IMPROVE_INSTRUCTION_PREFIX } from './ai-fake';
import { AI_DOC } from './fixtures';
import {
  documentTitle,
  importDocumentFromUrl,
  postInlineComment,
  register,
  threadRail,
  uniqueIdentity,
} from './helpers';
import { mcpAgentReview } from './mcp-agent';

// The M4 demo criterion, automated (SPEC §21 M4, #137): an agent connects over
// MCP and posts a review comment, and the author closes the loop with a digest
// and an improve-the-doc prompt.
//
// The agent hop is REAL. `e2e/mcp-agent.mjs` is the official MCP SDK client,
// spawned as its own process, speaking streamable HTTP to the served api with a
// bearer token this journey mints through the settings UI — the same path a
// third-party agent walks. Nothing about the transport, the server, or the
// Policies is stubbed; the only fake in the picture is the AI PROVIDER
// (AI_FAKE_RESPONSES, web/e2e/serve-api.sh), so no live model is ever called.
//
// The closing beat is the one that matters most: revoking the token in the UI
// must cut the agent off. So the revoked agent retries the exact call that
// worked a moment ago, and the journey asserts both halves — a 401, and a rail
// that gained no comment from it.

const JOURNEY_TIMEOUT = 180_000;

/** The whole agent vocabulary, as an agent sees it. Approvals are absent, by design. */
const MCP_TOOLS = [
  'get_digest',
  'get_document',
  'get_improve_prompt',
  'get_thread',
  'list_documents',
  'list_threads',
  'post_comment',
  'reply',
];

test('an agent posts over MCP under a minted token, the author digests and copies the prompt, revocation cuts the agent off', async ({
  page,
  context,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT);
  // The improve-prompt is asserted from the CLIPBOARD, not from the panel: what
  // the author pastes into their coding agent is the artifact this feature
  // promises to deliver verbatim.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const author = uniqueIdentity('mcp-agent');
  const humanComment = `The author's own note ${author.email}`;
  const agentComment = `Agent review over MCP ${author.email}`;
  const refusedComment = `This must never reach the review ${author.email}`;

  await register(page, author);
  const documentId = await importDocumentFromUrl(page, AI_DOC.url);
  await expect(documentTitle(page, AI_DOC.title)).toBeVisible();

  await postInlineComment(page, AI_DOC.authorAnchor, humanComment);

  // ---- Mint the agent's credential, in the real settings surface -----------
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Agent tokens' })).toBeVisible();
  await expect(page.getByText('No agent tokens yet.')).toBeVisible();

  await page.getByLabel('Agent token name', { exact: true }).fill('E2E Claude Code');
  await page.getByRole('button', { name: 'Create token', exact: true }).click();

  await expect(page.getByText('Copy this token now', { exact: false })).toBeVisible();
  const token = await page.getByLabel('New agent token', { exact: true }).inputValue();
  // Sanctum's `{id}|{secret}` — the shape the agent sends as a bearer token.
  expect(token).toMatch(/^\d+\|[A-Za-z0-9]{40,}$/);

  // ---- The agent hop: a real MCP client, out of process --------------------
  const review = await mcpAgentReview({
    token,
    title: AI_DOC.title,
    anchor: AI_DOC.mcpAnchor,
    body: agentComment,
  });

  expect(review, `the MCP client should have completed its review pass: ${JSON.stringify(review)}`)
    .toMatchObject({ ok: true });
  if (!review.ok) return;

  // The closed tool surface as the agent is offered it: no approve, no
  // lifecycle, no resolve, no suggestion, no share (SPEC §15).
  expect(review.tools).toEqual(MCP_TOOLS);
  // The document came from list_documents, and the anchor from the version's own
  // projection — the agent had to read the document to write about it.
  expect(review.document?.id).toBe(documentId);
  expect(review.comment?.client).toBe('mcp');
  expect(review.thread?.anchor_exact).toBe(AI_DOC.mcpAnchor);

  // ---- The browser sees a peer reviewer, badged --------------------------
  await page.goto(`/documents/${documentId}`);
  const rail = threadRail(page);

  const agentCard = rail.getByRole('article').filter({ hasText: agentComment });
  await expect(agentCard).toBeVisible();
  // Anchored where the agent said, not hanging off the document.
  await expect(agentCard.getByText(AI_DOC.mcpAnchor, { exact: true })).toBeVisible();

  // The violet AGENT · MCP treatment (DESIGN.md): the thread wears `agent`, the
  // comment row wears `mcp`, and both are violet — an agent is a visible peer,
  // never disguised as human.
  const mcpBadge = agentCard.getByText('mcp', { exact: true });
  await expect(mcpBadge).toBeVisible();
  await expect(mcpBadge).toHaveClass(/violet/);
  const agentBadge = agentCard.getByText('agent', { exact: true });
  await expect(agentBadge).toBeVisible();
  await expect(agentBadge).toHaveClass(/violet/);

  // ...and the human's own thread carries neither badge.
  const humanCard = rail.getByRole('article').filter({ hasText: humanComment });
  await expect(humanCard.getByText('mcp', { exact: true })).toHaveCount(0);
  await expect(humanCard.getByText('agent', { exact: true })).toHaveCount(0);

  // ---- The author closes the loop: digest ---------------------------------
  await page.getByRole('button', { name: 'AI digest', exact: true }).click();
  const digest = page.getByRole('dialog', { name: 'Review digest' });
  await expect(digest.getByText('No digest yet for this document.')).toBeVisible();

  await digest.getByRole('button', { name: 'Generate digest', exact: true }).click();
  await expect(digest.getByText(FAKE_DIGEST_THEME, { exact: true })).toBeVisible();
  // Coverage is computed from the REAL review — the author's thread and the
  // agent's — so this sentence proves the run read the document it claims to.
  await expect(digest.getByText('Covers all 2 threads.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(digest).toBeHidden();

  // ---- ...and the improve-the-doc prompt, copied --------------------------
  await page.getByRole('button', { name: 'Improve prompt', exact: true }).click();
  const improve = page.getByRole('dialog', { name: 'Improve-the-doc prompt' });
  await improve.getByRole('button', { name: 'Generate prompt', exact: true }).click();

  await expect(improve.getByText('2 unresolved threads · no required edits')).toBeVisible();
  await improve.getByRole('button', { name: 'Copy prompt', exact: true }).click();
  await expect(improve.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('# Improve this document');
  expect(copied).toContain(AI_DOC.title);
  // One instruction per thread the run actually sent — the model's contribution
  // reached the artifact rather than the artifact being rendered without it.
  expect(copied).toContain(FAKE_IMPROVE_INSTRUCTION_PREFIX);
  // The agent's thread is in the marching orders, quoted to its own anchor:
  // agents are reviewers whose feedback the author acts on, not a side channel.
  expect(copied).toContain(AI_DOC.mcpAnchor);
  await page.keyboard.press('Escape');

  // ---- Revocation is immediate, and it is the row ------------------------
  await page.goto('/settings');
  await expect(page.getByText('E2E Claude Code', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByText('No agent tokens yet.')).toBeVisible();

  const afterRevoke = await mcpAgentReview({
    token,
    title: AI_DOC.title,
    anchor: AI_DOC.mcpAnchor,
    body: refusedComment,
  });

  expect(afterRevoke.ok).toBe(false);
  if (afterRevoke.ok) return;
  expect(afterRevoke.status).toBe(401);

  // The refusal has to be a refusal: had revocation merely stopped SHOWING the
  // token, this call would have posted a third thread.
  await page.goto(`/documents/${documentId}`);
  await expect(rail.getByRole('article')).toHaveCount(2);
  await expect(page.getByText(refusedComment)).toHaveCount(0);
});
