import { describe, expect, it, vi } from 'vitest';
import { runDelete, runRescan } from '@/lib/tracked-repo-actions';
import type { DeleteTrackedRepoOutcome, RescanOutcome } from '@/lib/tracked-repos-client';
import type { TrackedRepo } from '@/lib/tracked-repo-scan';

// Pure coverage for the row's mutating actions (SPEC §16, M3.6, #94): the re-scan
// trigger and the delete flow, incl. the 409-while-running conflict message. The
// cores take injected stubs (functional core / imperative shell — the import-retry
// pattern), so behaviour tests without a DOM.

const repo: TrackedRepo = {
  id: 3,
  project_id: 10,
  repo_url: 'https://github.com/kedgehq/kedge',
  ref: 'main',
  path_pattern: 'docs/**',
  last_scan_status: 'ok',
  scan_error: null,
  last_scanned_at: null,
  last_scan_report: null,
  created_at: null,
};

describe('runRescan', () => {
  it('hands the settled record up and clears pending on success', async () => {
    const onRescanned = vi.fn();
    const setPending = vi.fn();
    const setError = vi.fn();

    await runRescan({
      id: 3,
      pending: false,
      rescan: async (): Promise<RescanOutcome> => ({ ok: true, trackedRepo: repo }),
      setPending,
      setError,
      onRescanned,
    });

    expect(onRescanned).toHaveBeenCalledWith(repo);
    expect(setError).toHaveBeenCalledWith(null);
    expect(setPending).toHaveBeenLastCalledWith(false);
  });

  it('surfaces the message and clears pending on failure', async () => {
    const onRescanned = vi.fn();
    const setError = vi.fn();

    await runRescan({
      id: 3,
      pending: false,
      rescan: async (): Promise<RescanOutcome> => ({ ok: false, message: 'Too many scans.' }),
      setPending: vi.fn(),
      setError,
      onRescanned,
    });

    expect(onRescanned).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('Too many scans.');
  });

  it('drops a press while one re-scan is in flight', async () => {
    const rescan = vi.fn();
    await runRescan({
      id: 3,
      pending: true,
      rescan,
      setPending: vi.fn(),
      setError: vi.fn(),
      onRescanned: vi.fn(),
    });
    expect(rescan).not.toHaveBeenCalled();
  });
});

describe('runDelete', () => {
  it('removes the row on success', async () => {
    const onRemoved = vi.fn();

    await runDelete({
      id: 3,
      pending: false,
      remove: async (): Promise<DeleteTrackedRepoOutcome> => ({ ok: true }),
      setPending: vi.fn(),
      setError: vi.fn(),
      onRemoved,
    });

    expect(onRemoved).toHaveBeenCalledWith(3);
  });

  it('surfaces the 409-while-running conflict message instead of removing', async () => {
    const onRemoved = vi.fn();
    const setError = vi.fn();

    await runDelete({
      id: 3,
      pending: false,
      remove: async (): Promise<DeleteTrackedRepoOutcome> => ({
        ok: false,
        kind: 'conflict',
        message: 'A scan is running — wait for it to finish, then delete.',
      }),
      setPending: vi.fn(),
      setError,
      onRemoved,
    });

    expect(onRemoved).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('A scan is running — wait for it to finish, then delete.');
  });

  it('drops a press while a delete is in flight', async () => {
    const remove = vi.fn();
    await runDelete({
      id: 3,
      pending: true,
      remove,
      setPending: vi.fn(),
      setError: vi.fn(),
      onRemoved: vi.fn(),
    });
    expect(remove).not.toHaveBeenCalled();
  });
});
