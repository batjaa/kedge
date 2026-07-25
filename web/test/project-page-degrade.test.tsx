import { renderToStaticMarkup } from './render-intl';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// The project page is a server component: mock its data reads and next/navigation
// so the three status branches can be driven directly (B5). The point: an
// unreachable projects read (5xx/network → 502) must degrade the page body, NOT
// masquerade as a 404 — a missing id and an outage both return an empty list.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  // The resolved page renders ProjectDocuments → ImportForm, which calls useRouter.
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
// The page now resolves its chrome strings server-side (M3.9): back the
// getTranslations call with a real translator over the REAL en-US catalog, so
// the branch assertions keep asserting authored copy — no request context in
// vitest, so next-intl's server entry must be stubbed.
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => {
    const { createTranslator } = await import('use-intl/core');
    const { loadMessages } = await import('@/lib/i18n/messages');
    return createTranslator({
      locale: 'en-US',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catalog tree as AbstractIntlMessages
      messages: loadMessages('en-US') as any,
      namespace,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- namespace is dynamic in the mock
    } as any);
  },
}));
vi.mock('@/lib/projects', () => ({ getProjects: vi.fn() }));
vi.mock('@/lib/documents', () => ({ getDocuments: vi.fn() }));
vi.mock('@/lib/tracked-repos', () => ({ getTrackedRepos: vi.fn() }));

const ProjectPage = (await import('@/app/(app)/projects/[id]/page')).default;
const { getProjects } = await import('@/lib/projects');
const { getDocuments } = await import('@/lib/documents');
const { getTrackedRepos } = await import('@/lib/tracked-repos');
const { notFound } = await import('next/navigation');

function run(id = '10') {
  return ProjectPage({ params: Promise.resolve({ id }) });
}

describe('ProjectPage status branches (B5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDocuments as Mock).mockResolvedValue({
      status: 200,
      page: { data: [], meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 } },
    });
    (getTrackedRepos as Mock).mockResolvedValue({ status: 200, trackedRepos: [] });
  });

  it('degrades the page body when the projects read is unreachable, never 404', async () => {
    (getProjects as Mock).mockResolvedValue({ status: 502, projects: [] });

    const html = renderToStaticMarkup(await run());

    expect(html).toContain('unreachable');
    expect(html).toContain('Review queue'); // the way out is still offered
    expect(notFound).not.toHaveBeenCalled();
  });

  it('404s a genuinely-absent id on a 200 read', async () => {
    (getProjects as Mock).mockResolvedValue({ status: 200, projects: [] });

    await expect(run('999')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('redirects to signin on a refused read', async () => {
    (getProjects as Mock).mockResolvedValue({ status: 401, projects: [] });

    await expect(run()).rejects.toThrow('NEXT_REDIRECT:/signin');
    expect(notFound).not.toHaveBeenCalled();
  });

  it('renders the project when the read succeeds', async () => {
    (getProjects as Mock).mockResolvedValue({
      status: 200,
      projects: [{ id: 10, name: 'Anchoring', slug: 'anchoring', description: null, created_at: null }],
    });

    const html = renderToStaticMarkup(await run('10'));

    expect(html).toContain('Anchoring');
    expect(html).not.toContain('unreachable');
    expect(notFound).not.toHaveBeenCalled();
  });
});
