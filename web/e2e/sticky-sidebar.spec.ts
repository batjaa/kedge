import { expect, test, type Page } from '@playwright/test';
import { register, uniqueIdentity } from './helpers';

// The #146 seam. Sidebar stickiness is a layout invariant that spans TWO
// components, and neither half is provable from markup:
//
//   1. the sticky box must be the ROOT of DocumentReviewSidebar, and
//   2. the `w-72` column in DocumentReviewSurface must stay stretched to the
//      full review row, so that box has travel inside its containing block.
//
// The shipped bug was half 1 (a bare auto-height <aside> wrapper gave the
// sticky box exactly its own height of slack — zero), and the giveaway is that
// a sticky element which never engages renders byte-identical HTML to one that
// works. test/document-review-sidebar.test.tsx pins half 1 structurally; only
// a real browser can catch half 2, which is what this journey is for.
//
// It registers its own user and pastes its own document, like every spec in the
// pack, so it depends on no other journey's state.

const SECTION_COUNT = 40;

// Long enough that the prose column dwarfs the sidebar — the only condition
// under which a dead sticky is observable at all. Paste-mode content, so the
// journey needs no fixture server and no network beyond the API.
const LONG_DOCUMENT = [
  '# Sticky sidebar journey',
  '',
  'A document tall enough to scroll many viewports, so a sidebar that travels',
  'with the prose is unmistakably distinguishable from one that pins.',
  '',
  ...Array.from({ length: SECTION_COUNT }, (_, index) => [
    `## Section ${index + 1}`,
    '',
    `Body copy for section ${index + 1}. `.repeat(24),
    '',
  ]).flat(),
].join('\n');

// `top-32`: the pinned offset that clears the app shell's h-14 bar plus the
// sticky document header.
const PINNED_TOP = 128;

// The collapse controls carry their label as aria-label (ColumnToggleButton and
// the sidebar's own hide button). This spec runs in the default en-US context —
// the negotiated-locale surfaces are e2e/i18n-review.spec.ts's business.
const HIDE_SIDEBAR_LABEL = 'Hide contents and threads';
const SHOW_SIDEBAR_LABEL = 'Show contents and threads';

/** Viewport-relative top of the sidebar, read from the browser's own layout. */
function sidebarTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('aside[data-review-sidebar]');
    if (el === null) throw new Error('review sidebar not in the DOM');
    return Math.round(el.getBoundingClientRect().top);
  });
}

// The collapsed sidebar column pins a bare toggle instead of the <aside>. Its
// pinned box is the button's sticky ancestor — resolved by computed style
// rather than by class name, so this keeps asserting the BEHAVIOUR (something
// in that column is sticky and holds at the offset) if the markup is restyled.
function collapsedToggleTop(page: Page): Promise<number> {
  return page.evaluate((label) => {
    const button = document.querySelector(`button[aria-label="${label}"]`);
    if (button === null) throw new Error('collapsed sidebar toggle not in the DOM');

    for (let el = button.parentElement; el !== null; el = el.parentElement) {
      if (getComputedStyle(el).position === 'sticky') {
        return Math.round(el.getBoundingClientRect().top);
      }
    }
    throw new Error('collapsed sidebar toggle has no sticky ancestor');
  }, SHOW_SIDEBAR_LABEL);
}

async function scrollTo(page: Page, y: number): Promise<void> {
  await page.evaluate((target) => window.scrollTo(0, target), y);
  // Two frames: one for the scroll to apply, one for sticky to settle.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function openLongDocument(page: Page): Promise<void> {
  await register(page, uniqueIdentity('sticky-sidebar'));

  await page.getByRole('tab', { name: 'Paste content', exact: true }).click();
  await page.getByLabel('Content', { exact: true }).fill(LONG_DOCUMENT);
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  const rows = page.getByRole('region', { name: 'Your documents' }).getByRole('link');
  await expect(rows).toHaveCount(1, { timeout: 30_000 });
  await rows.first().click();
  await expect(page).toHaveURL(/\/documents\/\d+$/, { timeout: 30_000 });

  await expect(page.locator('aside[data-review-sidebar]')).toBeVisible();
  // The document has to actually be taller than the viewport, or the assertions
  // below would pass on a sidebar that simply had nowhere to scroll to.
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(scrollable).toBeGreaterThan(4000);
}

test('the review sidebar pins below the header while a long document scrolls', async ({ page }) => {
  await openLongDocument(page);

  await scrollTo(page, 0);
  // Unpinned at rest: the sidebar starts below its pinned offset, in flow.
  expect(await sidebarTop(page)).toBeGreaterThan(PINNED_TOP);

  // The regression: before #146 this read as a large negative number — the
  // sidebar had scrolled clean off the top of the viewport with the prose.
  await scrollTo(page, 3000);
  expect(await sidebarTop(page)).toBe(PINNED_TOP);

  await scrollTo(page, 9000);
  expect(await sidebarTop(page)).toBe(PINNED_TOP);

  // Narrower, still at/above the `lg` breakpoint where the column renders.
  await page.setViewportSize({ width: 1024, height: 720 });
  await scrollTo(page, 6000);
  expect(await sidebarTop(page)).toBe(PINNED_TOP);

  // Pinning must not cost horizontal room at either width.
  for (const width of [1024, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    await scrollTo(page, 6000);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});

test('a sidebar taller than the viewport scrolls inside itself', async ({ page }) => {
  await openLongDocument(page);

  // A short viewport guarantees the 40-heading table of contents overflows the
  // sidebar's max-height, so the internal scroll has real work to do.
  await page.setViewportSize({ width: 1280, height: 500 });
  await scrollTo(page, 3000);
  expect(await sidebarTop(page)).toBe(PINNED_TOP);

  const internal = await page.evaluate(() => {
    const el = document.querySelector('aside[data-review-sidebar]');
    if (el === null) throw new Error('review sidebar not in the DOM');
    el.scrollTop = 300;
    return {
      overflows: el.scrollHeight > el.clientHeight,
      scrolled: el.scrollTop,
      pageScrollY: Math.round(window.scrollY),
    };
  });

  expect(internal.overflows).toBe(true);
  expect(internal.scrolled).toBeGreaterThan(0);
  // Scrolling the sidebar must not have dragged the document with it.
  expect(internal.pageScrollY).toBe(3000);
});

test('the collapsed sidebar toggle keeps sticking', async ({ page }) => {
  await openLongDocument(page);

  await scrollTo(page, 0);
  await page.getByRole('button', { name: HIDE_SIDEBAR_LABEL, exact: true }).click();
  await expect(page.locator('aside[data-review-sidebar]')).toBeHidden();

  await scrollTo(page, 3000);
  expect(await collapsedToggleTop(page)).toBe(PINNED_TOP);

  // And re-expanding restores a sidebar that is still pinned, not one that has
  // been left behind at the top of the document.
  await page.getByRole('button', { name: SHOW_SIDEBAR_LABEL, exact: true }).click();
  await expect(page.locator('aside[data-review-sidebar]')).toBeVisible();
  await scrollTo(page, 5000);
  expect(await sidebarTop(page)).toBe(PINNED_TOP);
});
