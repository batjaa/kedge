import { renderToStaticMarkup } from './render-intl';
import { describe, expect, it, vi } from 'vitest';

// Static-markup coverage for the Settings → General card (SPEC §16, M3.7 decision
// 11A). The card is a client island (it saves through the workspace client and
// calls router.refresh on success), but its initial render is a pure function of
// the workspace prop — so renderToStaticMarkup exercises the field seeding and
// copy. The rename/collision interaction is covered end-to-end by the
// settings-rename Playwright journey. ImportForm's pattern: stub next/navigation
// and import the component after the mock.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

const { WorkspaceGeneralCard } = await import('@/components/app/workspace-general-card');

describe('WorkspaceGeneralCard', () => {
  it('seeds the name and slug fields from the workspace and offers Save', () => {
    const html = renderToStaticMarkup(
      <WorkspaceGeneralCard workspace={{ id: 7, name: "Batjaa's workspace", slug: 'batjaa' }} />,
    );

    // Panel title, per the app-workspace mockup.
    expect(html).toContain('General');

    // The editable fields carry the current values.
    expect(html).toContain('aria-label="Workspace name"');
    expect(html).toContain('value="Batjaa&#x27;s workspace"');
    expect(html).toContain('aria-label="Workspace slug"');
    expect(html).toContain('value="batjaa"');

    expect(html).toContain('Save');
  });

  it('starts with Save disabled (nothing changed yet) and no error alert', () => {
    const html = renderToStaticMarkup(
      <WorkspaceGeneralCard workspace={{ id: 7, name: 'Harbor', slug: 'harbor' }} />,
    );

    // Unchanged fields → the primary action is inert until the owner edits.
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('role="alert"');
  });
});
