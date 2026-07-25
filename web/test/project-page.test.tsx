import { renderToStaticMarkup } from './render-intl';
import { describe, expect, it, vi } from 'vitest';
import { ProjectHeader } from '@/components/app/project-header';
import { ProjectCreate } from '@/components/app/project-create';
import type { DocumentListItem, DocumentListPage, Project } from '@/lib/document-types';
import type { TrackedRepo } from '@/lib/tracked-repo-scan';

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
      <ProjectDocuments
        project={{ id: 10, name: 'Anchoring' }}
        initialOtherPage={page()}
        projects={[project({})]}
      />,
    );

    expect(html).toContain('Import into this project');
    // The list re-uses the M3.5 rows (a real link to the document).
    expect(html).toContain('href="/documents/5"');
    // Flat (single project): no group header linking back to the project page.
    expect(html).not.toContain('href="/projects/10"');
    // With no tracked repos the whole list keeps the plain "Documents" heading.
    expect(html).toContain('Documents');
    expect(html).not.toContain('Other documents');
  });

  it('shows the empty state pointing at import and assignment', () => {
    const html = renderToStaticMarkup(
      <ProjectDocuments
        project={{ id: 10, name: 'Anchoring' }}
        initialOtherPage={emptyPage()}
        projects={[project({})]}
      />,
    );

    expect(html).toContain('No documents in this project yet');
    expect(html).toContain('assign an existing document');
  });

  it('degrades the list area alone when the project read was unreachable', () => {
    const html = renderToStaticMarkup(
      <ProjectDocuments
        project={{ id: 10, name: 'Anchoring' }}
        initialOtherPage={null}
        projects={[project({})]}
      />,
    );

    // The import box still renders; only the list area falls back (3A).
    expect(html).toContain('Import into this project');
    expect(html).toContain('unreachable');
  });

  it('renders a repo section headed by its short name, with the Other-documents section beside it', () => {
    const html = renderToStaticMarkup(
      <ProjectDocuments
        project={{ id: 10, name: 'Anchoring' }}
        projects={[project({})]}
        initialTrackedRepos={[repo()]}
        initialRepoPages={{ 7: repoPage() }}
        initialOtherPage={emptyPage()}
      />,
    );

    // The repo section header is the repo's owner/repo short name.
    expect(html).toContain('kedgehq/kedge');
    // Its path-ordered doc renders under it.
    expect(html).toContain('href="/documents/8"');
    // With a repo attached, the leftover bucket is explicitly "Other documents".
    expect(html).toContain('Other documents');
  });

  it('shows the empty-source state for a repo section with no documents yet', () => {
    const html = renderToStaticMarkup(
      <ProjectDocuments
        project={{ id: 10, name: 'Anchoring' }}
        projects={[project({})]}
        initialTrackedRepos={[repo()]}
        initialRepoPages={{ 7: emptyPage() }}
        initialOtherPage={emptyPage()}
      />,
    );

    // The header stays; the body explains the source is empty (not degraded).
    expect(html).toContain('kedgehq/kedge');
    expect(html).toContain('No documents yet from this source');
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
    source: { kind: 'upload' },
    tracked_repo_id: null,
    created_at: null,
  };
}

function repo(): TrackedRepo {
  return {
    id: 7,
    project_id: 10,
    repo_url: 'https://github.com/kedgehq/kedge',
    ref: 'main',
    path_pattern: 'docs/**/*.md',
    last_scan_status: 'ok',
    scan_error: null,
    last_scanned_at: null,
    last_scan_report: null,
    created_at: null,
  };
}

/** A repo section's page: one repo-sourced, path-ordered document. */
function repoPage(): DocumentListPage {
  return {
    data: [
      {
        ...row(),
        id: 8,
        title: 'Repo doc',
        source: { kind: 'repo', path: 'docs/overview.md' },
        tracked_repo_id: 7,
      },
    ],
    meta: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
  };
}
