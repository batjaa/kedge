import { expect, test } from '@playwright/test';

// The M0 demo criterion, end to end (SPEC scaffold — Testing Decisions, seam 2).
//
// One journey, deliberately not a suite: a visitor registers through the real
// browser, lands on the authenticated shell, reloads (the session survives),
// and signs out (the session is actually invalidated). This is the only
// automated proof that the BFF cookie handshake works across the two
// deployables — the browser sets the httpOnly Sanctum cookie against the API on
// :8000, and every guarded page on the web app on :3000 reads it back.
//
// Selectors are role/label based and exact so the journey survives cosmetic
// changes — notably an extra "Continue with GitHub" button arriving on the
// sign-in page (ticket #6). "Sign in" is matched exactly so it never collides
// with a "... with GitHub" label.
//
// It also pins the Open Harbor theme contract (m3.7): the shell opens light by
// default, an explicit dark choice takes effect immediately, and that per-device
// choice rides the same reload that proves the session persists.

test('register → land on the shell → reload persists → sign out', async ({
  page,
}) => {
  // Unique per run: a fresh scratch DB already isolates runs, but a unique
  // email also keeps the journey green against a reused local stack.
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-${stamp}@kedge.test`;
  const password = 'correct-horse-battery-staple';
  const name = 'E2E Reviewer';

  // 1. Register through the real browser.
  await page.goto('/signup');
  await expect(
    page.getByRole('heading', { name: 'Create your account' }),
  ).toBeVisible();

  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();

  // 2. Land on the authenticated shell — the whole point of the handshake.
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  // The header shows the signed-in identity read back through the BFF.
  await expect(page.getByText(email)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();

  // The shell opens in the Open Harbor light register by default (DESIGN.md
  // light-first): with no stored choice, <html> carries no `dark` class.
  const html = page.locator('html');
  await expect(html).not.toHaveClass(/\bdark\b/);

  // An explicit dark choice from the header toggle takes effect immediately.
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(html).toHaveClass(/\bdark\b/);

  // 3. Reload: a full navigation must re-read the session server-side and keep
  //    us on the shell (the cookie persists, not just client state).
  await page.reload();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  // The dark choice is per-device and rides the reload alongside the session.
  await expect(html).toHaveClass(/\bdark\b/);

  // 4. Sign out → back to the signed-out state.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/signin(\?|$)/);
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();

  // 5. Prove the session was really invalidated, not just navigated away from.
  //    The SaaS anonymous home is now the Open Harbor marketing landing (#109),
  //    whose hero hosts the instant-demo paste box — so `/` shows the stranger
  //    surface, not the signed-in review queue. `Review queue` is matched exactly:
  //    the landing's roadmap has an "Inbox & review queue" card that a substring
  //    match would otherwise collide with (selector churn only — the behaviour
  //    asserted, that the authenticated queue heading is absent, is unchanged).
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Render it', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Review queue', exact: true }),
  ).toBeHidden();

  //    And a guarded route still bounces an anonymous visitor back to sign-in —
  //    the actual proof the session is dead.
  await page.goto('/documents/1');
  await expect(page).toHaveURL(/\/signin(\?|$)/);
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
});
