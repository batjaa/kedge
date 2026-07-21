import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectHeader } from '@/components/app/project-header';
import { ProjectCreate } from '@/components/app/project-create';
import type { DocumentListItem, DocumentListPage, Project } from '@/lib/document-types';

// Static-markup coverage for the M3.6 project surfaces: the editable project
// header, the home's create affordance, and the project page's live island.
// ProjectDocuments renders ImportForm, which calls useRouter — stub
// next/navigation and import it after the mock (the workspace-home pattern).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

const { ProjectDocuments } = await import('@/components/app/project-documents');

describe('ProjectHeader', () => {
  it('renders the project name, its description, and an edit affordance', () => {
    const html = renderToStaticMarkup(
      <ProjectHeader project={project({ description: 'The re-anchoring effort.' })} />,
    );

    expect(html).toContain('Anchoring');
    expect(html).toContain('The re-anchoring effort.');
    expect(html).toContain('Edit');
  });

  it('notes a missing description rather than rendering an empty header', () => {
    const html = renderToStaticMarkup(<ProjectHeader project={project({ description: null })} />);
    expect(html).toContain('No description yet');
  });
});

describe('ProjectCreate', () => {
  it('renders the create-project panel (name required, description optional)', () => {
    const html = renderToStaticMarkup(<ProjectCreate onCreated={() => {}} />);

    expect(html).toContain('Projects');
    expect(html).toContain('Project name');
    expect(html).toContain('Create project');
    // The description field is offered but optional.
    expect(html).toContain('optional');
  });
});

describe('ProjectDocuments', () => {
  it('renders the project import box and the filtered document rows', () => {
    const html = renderToStaticMarkup(
      <ProjectDocuments projectId={10} initialPage={page()} projects={[project({})]} />,
    );

    expect(html).toContain('Import into this project');
    // The list re-uses the M3.5 rows (a real link to the document).
    expect(html).toContain('href="/documents/5"');
    // Flat (single project): no group header linking back to the project page.
    expect(html).not.toContain('href="/projects/10"');
  });

  it('shows the empty state pointing at import and assignment', () => {
    const html = renderToStaticMarkup(
      <ProjectDocuments projectId={10} initialPage={emptyPage()} projects={[project({})]} />,
    );

    expect(html).toContain('No documents in this project yet');
    expect(html).toContain('assign an existing document');
  });

  it('degrades the list area alone when the project read was unreachable', () => {
    const html = renderToStaticMarkup(
      <ProjectDocuments projectId={10} initialPage={null} projects={[project({})]} />,
    );

    // The import box still renders; only the list area falls back (3A).
    expect(html).toContain('Import into this project');
    expect(html).toContain('unreachable');
  });
});

function project(overrides: Partial<Project>): Project {
  return {
    id: 10,
    name: 'Anchoring',
    slug: 'anchoring',
    description: null,
    created_at: null,
    ...overrides,
  };
}

function page(): DocumentListPage {
  return {
    data: [row()],
    meta: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
  };
}

function emptyPage(): DocumentListPage {
  return {
    data: [],
    meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 },
  };
}

function row(): DocumentListItem {
  return {
    id: 5,
    title: 'Filed doc',
    status: 'ready',
    last_sync_status: 'ok',
    sync_error: null,
    lifecycle_status: 'draft',
    open_threads_count: 0,
    synced_at: null,
    project: { id: 10, name: 'Anchoring' },
    created_at: null,
  };
}
