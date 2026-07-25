import { renderToStaticMarkup } from './render-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatsStrip } from '@/components/app/stats-strip';
import {
  alsoRefresh,
  createLatestWinsGate,
  nextSummary,
  readWorkspaceSummary,
} from '@/lib/workspace-summary';
import type { WorkspaceSummary } from '@/lib/document-types';

// The stats strip's two spec lines (SPEC §16, M3.7): degradation (A1 — a null
// summary renders NOTHING so the list is never blocked) and refresh-on-settle
// (6A — a settle/retry/refile re-reads the strip by piggybacking the existing
// callback, no new poll loop). Prior art: workspace-home.test / documents-client.

describe('StatsStrip degradation (A1)', () => {
  it('renders nothing when the summary is unavailable', () => {
    // The server seed failed (or a first read never recovered): the strip is
    // absent entirely, so the degraded banner the documents list owns is the only
    // outage signal and the list is never blocked.
    expect(renderToStaticMarkup(<StatsStrip summary={null} />)).toBe('');
  });

  it('renders the always-on counts and only the non-zero alert stats', () => {
    const html = renderToStaticMarkup(<StatsStrip summary={summary()} />);

    // Documents + open threads always show.
    expect(html).toContain('documents');
    expect(html).toContain('open threads');
    // The three alert stats show because the fixture has each > 0.
    expect(html).toContain('orphaned');
    expect(html).toContain('approvals stale');
    expect(html).toContain('importing');
  });

  it('hides the alert stats a healthy workspace has none of', () => {
    const html = renderToStaticMarkup(
      <StatsStrip
        summary={summary({
          threads: { open: 4, orphaned: 0 },
          approvals: { stale: 0 },
          documents: { total: 8, importing: 0, needs_attention: 0, lifecycle: lifecycle() },
        })}
      />,
    );

    expect(html).toContain('documents');
    expect(html).toContain('open threads');
    // No noise on a clean workspace.
    expect(html).not.toContain('orphaned');
    expect(html).not.toContain('approvals stale');
    expect(html).not.toContain('importing');
  });
});

describe('refresh-on-settle wiring (6A)', () => {
  it('runs the original callback AND triggers a summary refresh', () => {
    // The exact 6A contract: a settle handler both settles the row (original
    // callback) and re-reads the strip (refresh) — one call each, in order.
    const settled = vi.fn();
    const refresh = vi.fn();
    const order: string[] = [];
    settled.mockImplementation(() => order.push('settle'));
    refresh.mockImplementation(() => order.push('refresh'));

    const wrapped = alsoRefresh(settled, refresh);
    const doc = { id: 7 };
    wrapped(doc);

    expect(settled).toHaveBeenCalledWith(doc);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The row state settles first (source of truth), then the strip re-reads.
    expect(order).toEqual(['settle', 'refresh']);
  });

  it('forwards every argument to the wrapped callback', () => {
    const retried = vi.fn();
    const wrapped = alsoRefresh(retried, vi.fn());

    wrapped(42);

    expect(retried).toHaveBeenCalledWith(42);
  });
});

describe('createLatestWinsGate — overlapping refreshes (R)', () => {
  it('only the newest token stays current', () => {
    const gate = createLatestWinsGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it('drops an out-of-order response so the latest read wins, not the last to resolve', () => {
    // Two refreshes fire in one tick; the LATER one (t2 → fresh) resolves first,
    // then the earlier one (t1 → stale) resolves. The stale response must be
    // dropped, so the fresh snapshot sticks with no later event to correct it.
    const gate = createLatestWinsGate();
    const fresh = summary({ documents: { ...summary().documents, total: 20 } });
    const stale = summary({ documents: { ...summary().documents, total: 5 } });

    const t1 = gate.begin();
    const t2 = gate.begin();

    let state: WorkspaceSummary | null = null;
    if (gate.isCurrent(t2)) state = nextSummary(state, fresh); // later read resolves first
    if (gate.isCurrent(t1)) state = nextSummary(state, stale); // earlier read resolves last — dropped

    expect(state).toBe(fresh);
  });
});

describe('nextSummary — refresh keeps last-good (A1)', () => {
  it('replaces the strip on a successful read', () => {
    const current = summary();
    const fetched = summary({ documents: { ...current.documents, total: 99 } });

    expect(nextSummary(current, fetched)).toBe(fetched);
  });

  it('keeps the last-good summary when a refresh fails', () => {
    // A mid-session refresh hiccup must not blank a strip that was showing real
    // counts — degradation is the INITIAL null, not a transient one.
    const current = summary();

    expect(nextSummary(current, null)).toBe(current);
  });

  it('stays null while the initial read has never succeeded', () => {
    expect(nextSummary(null, null)).toBeNull();
  });
});

describe('readWorkspaceSummary transient failures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves to null when the fetch rejects (network blip)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));

    await expect(readWorkspaceSummary()).resolves.toBeNull();
  });

  it('maps a non-ok response to null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));

    await expect(readWorkspaceSummary()).resolves.toBeNull();
  });

  it('returns the parsed summary on a 200', async () => {
    const body = summary();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => body } as Response),
    );

    await expect(readWorkspaceSummary()).resolves.toEqual(body);
  });
});

function lifecycle(): WorkspaceSummary['documents']['lifecycle'] {
  return { draft: 3, in_review: 2, approved: 3, superseded: 0 };
}

function summary(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    documents: { total: 8, importing: 1, needs_attention: 2, lifecycle: lifecycle() },
    threads: { open: 12, orphaned: 1 },
    approvals: { stale: 2 },
    ...overrides,
  };
}
