import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TrackedRepoPanel } from '@/components/app/tracked-repo-panel';

// Static-markup coverage for the "Track a repository" form (SPEC §16, M3.6). The
// panel is a client island, but its initial render (form + hints, no preview yet)
// is a pure function of props, so renderToStaticMarkup exercises the form copy.

describe('TrackedRepoPanel form', () => {
  it('recommends the workspace PAT for large public repos (spec 4A, C10)', () => {
    const html = renderToStaticMarkup(
      <TrackedRepoPanel
        project={{ id: 10, name: 'Anchoring' }}
        repos={[]}
        setRepos={() => {}}
        onScanSettled={() => {}}
      />,
    );

    // The PAT recommendation names the unauthenticated rate limit so the reason is clear.
    expect(html).toContain('workspace GitHub PAT');
    expect(html).toContain('60 requests');
    // The core form is present.
    expect(html).toContain('Repository URL');
    expect(html).toContain('Path pattern');
  });
});
