import { expect, test } from '@playwright/test';
import { DIAGRAMS_DOC } from './fixtures';
import { documentTitle, importDocumentFromUrl, register, uniqueIdentity } from './helpers';

// Diagram rendering surfaces (import-render spec — SPEC §6.2, #48/#53; #39). One
// imported document, two fenced blocks, one allowlist deciding between them:
//   - a mermaid fence renders as a cached SVG <img> from /storage/diagrams
//     (Kroki: a service container in CI, hosted kroki.io locally) — never a plain
//     code block;
//   - an unknown-language fence stays ONE contiguous plain <pre> code block (#53),
//     never routed to Kroki.
// Plus the click-to-zoom lightbox: opening the diagram and closing it with ESC.

// Kroki renders cold on first hit; give the render + next-dev compile room. Not a
// retry — a wider ceiling still fails loudly.
const JOURNEY_TIMEOUT = 120_000;

test('mermaid fence → decoded SVG image; unknown fence → plain code; click-to-zoom opens and ESC closes', async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  await register(page, uniqueIdentity('diagrams'));
  await importDocumentFromUrl(page, DIAGRAMS_DOC.url);
  await expect(documentTitle(page, DIAGRAMS_DOC.title)).toBeVisible();

  // The mermaid fence became a cached-SVG <img> from the API's render cache, and
  // it really decoded (naturalWidth > 0 — a 404 or error body would be 0).
  const diagram = page.getByRole('img', { name: 'mermaid diagram' });
  await expect(diagram).toBeVisible({ timeout: 30_000 });
  await expect(diagram).toHaveAttribute(
    'src',
    /\/storage\/diagrams\/mermaid\/[0-9a-f]{64}\.svg$/,
  );
  await expect
    .poll(() => diagram.evaluate((img) => (img as HTMLImageElement).naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  // The mermaid source never fell through to a plain code block (the unknown-fence
  // / render-failure path).
  await expect(
    page.locator('pre', { hasText: DIAGRAMS_DOC.mermaidSource }),
  ).toHaveCount(0);

  // The unknown-language fence stayed plain code — exactly one contiguous <pre>
  // (#53), never a diagram.
  await expect(
    page.locator('pre', { hasText: DIAGRAMS_DOC.plainFenceText }),
  ).toHaveCount(1);

  // Click-to-zoom: the whole diagram panel is a button; clicking it opens the
  // lightbox dialog, and ESC closes it (the diagram spike's legibility fix).
  const zoom = page.getByRole('button', { name: 'Zoom mermaid diagram' });
  await expect(zoom).toBeVisible();
  await zoom.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
