import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TrackedRepoPreview, type PreviewView } from '@/components/app/tracked-repo-preview';

// Static-markup coverage for the tracked-repo preview panel states (SPEC §16,
// M3.6, story 8): matches, overlap warnings inline (10A), over-cap (story 18),
// truncation (4A), empty, and loading. The panel is a pure view of its `view`
// prop, so each state renders from props alone — no async, no network.

function render(view: PreviewView): string {
  return renderToStaticMarkup(<TrackedRepoPreview view={view} />);
}

describe('TrackedRepoPreview', () => {
  it('shows a loading state while the preview is in flight', () => {
    const html = render({ kind: 'loading' });
    expect(html).toContain('Checking the repository');
  });

  it('lists the matched files with the count', () => {
    const html = render({
      kind: 'matches',
      overlapCount: 0,
      files: [
        { path: 'docs/spec.md', overlap: false },
        { path: 'docs/design.md', overlap: false },
      ],
    });

    expect(html).toContain('docs/spec.md');
    expect(html).toContain('docs/design.md');
    expect(html).toContain('2 files match');
    // The import affordance is present but inert until the scan (#93).
    expect(html).toContain('Add &amp; scan');
    expect(html).toContain('disabled');
    expect(html).toContain('#93');
  });

  it('flags a file already tracked elsewhere in the workspace (10A)', () => {
    const html = render({
      kind: 'matches',
      overlapCount: 1,
      files: [
        { path: 'docs/spec.md', overlap: true },
        { path: 'docs/new.md', overlap: false },
      ],
    });

    expect(html).toContain('Already tracked');
    expect(html).toContain('1 already tracked elsewhere');
  });

  it('shows the empty state when nothing matches', () => {
    const html = render({ kind: 'matches', overlapCount: 0, files: [] });
    expect(html).toContain('0 files match this pattern');
  });

  it('shows an explicit over-cap error naming the count (story 18)', () => {
    const html = render({
      kind: 'over_cap',
      message: '347 files match — over the 200-file cap. Narrow the pattern before importing.',
    });

    expect(html).toContain('347 files match');
    expect(html).toContain('200-file cap');
    expect(html).toContain('role="alert"');
  });

  it('shows an explicit truncation error (4A)', () => {
    const html = render({
      kind: 'truncated',
      message: 'This repository is too large for GitHub to list in full. Narrow the pattern to a subdirectory, or connect a PAT.',
    });

    expect(html).toContain('too large for GitHub to list');
    expect(html).toContain('role="alert"');
  });

  it('shows a generic upstream error message (e.g. a non-branch ref)', () => {
    const html = render({
      kind: 'error',
      message: "Couldn't find a branch named \"v1.0\". Tracked repos follow a branch — tags and commit SHAs aren't supported.",
    });

    expect(html).toContain('Tracked repos follow a branch');
  });
});
