import { expect, test } from '@playwright/test';
import { MDX_COMPONENTS_DOC, MDX_SMUGGLED_DOC } from './fixtures';
import { documentTitle, importDocumentFromUrl, register, uniqueIdentity } from './helpers';

// MDX safety in the browser (import-render spec — SPEC §6.1, hard rule #2; #39).
// Imported MDX is untrusted code. Two documents prove the security model renders
// as specified on the real page, never just in a unit test:
//
//   1. An allowlisted component renders; an unknown one degrades to a neutral
//      "Unsupported component" box (rewrite, never execute, never crash).
//   2. A smuggled ES import is rejected at compile — the page falls back to plain
//      markdown with a banner, and a <script> smuggled alongside it leaves NO
//      trace in the DOM: no marker text, no global, no hijacked title.

test('allowlisted MDX component renders; an unknown component becomes a neutral box', async ({
  page,
}) => {
  await register(page, uniqueIdentity('mdx-allow'));
  await importDocumentFromUrl(page, MDX_COMPONENTS_DOC.url);
  await expect(documentTitle(page, MDX_COMPONENTS_DOC.title)).toBeVisible();

  // The allowlisted <Callout> survived the harden pass and renders as a styled
  // admonition with its title and body.
  await expect(page.getByText('Allowlisted callout')).toBeVisible();
  await expect(
    page.getByText('This Callout is on the imported-MDX allowlist'),
  ).toBeVisible();

  // The unknown <Fancy> component degraded to the neutral box, naming what was
  // dropped — never executed, never a crash.
  await expect(page.getByText('Unsupported component', { exact: true })).toBeVisible();
  await expect(
    page.getByText(`<${MDX_COMPONENTS_DOC.unknownComponentName} />`),
  ).toBeVisible();

  // Prose after the unsupported component still renders — the page is intact.
  await expect(
    page.getByText('Ordinary prose after the unsupported component still renders'),
  ).toBeVisible();
});

test('a smuggled import falls back to plain markdown with a banner, and the injected script never runs', async ({
  page,
}) => {
  await register(page, uniqueIdentity('mdx-smuggled'));
  await importDocumentFromUrl(page, MDX_SMUGGLED_DOC.url);
  await expect(documentTitle(page, MDX_SMUGGLED_DOC.title)).toBeVisible();

  // The rejected compile fell back to plain markdown, with the author-visible
  // degradation banner.
  await expect(page.getByText('MDX failed to compile; showing plain markdown')).toBeVisible();

  // Prose still renders through the fallback — degraded, but not lost.
  await expect(
    page.getByText('Ordinary prose after the script still renders'),
  ).toBeVisible();

  // The injected <script> left NO trace: its marker text appears nowhere in the
  // DOM, its global was never set, and it did not hijack the document title.
  await expect(page.getByText(MDX_SMUGGLED_DOC.xssMarker)).toHaveCount(0);
  const leaked = await page.evaluate(
    () => (window as unknown as { __kedge_xss_39?: unknown }).__kedge_xss_39 ?? null,
  );
  expect(leaked).toBeNull();
  expect(await page.title()).not.toContain(MDX_SMUGGLED_DOC.xssMarker);
});
