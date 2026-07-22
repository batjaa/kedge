import { describe, expect, it, vi } from 'vitest';
import { runProjectAssign } from '@/lib/assign-project';
import type { AssignProjectOutcome } from '@/lib/projects-client';
import type { Document } from '@/lib/document-types';

// Pure coverage for the row project chip's assignment core (SPEC §16, M3.6, B2):
// success regroups the island, a mapped failure and a rejected fetch both surface a
// message and leave the document unmoved (so the controlled <select> reverts), and
// pending always clears — a network blip can never wedge the select disabled.

const moved = { id: 5, project: { id: 10, name: 'Anchoring' } } as unknown as Document;

describe('runProjectAssign', () => {
  it('regroups on success and clears pending', async () => {
    const onAssigned = vi.fn();
    const setPending = vi.fn();
    const setError = vi.fn();

    await runProjectAssign({
      documentId: 5,
      nextId: 10,
      currentId: null,
      pending: false,
      assign: async (): Promise<AssignProjectOutcome> => ({ ok: true, document: moved }),
      setPending,
      setError,
      onAssigned,
    });

    expect(onAssigned).toHaveBeenCalledWith(moved);
    expect(setError).toHaveBeenCalledWith(null);
    expect(setPending).toHaveBeenLastCalledWith(false);
  });

  it('surfaces the message and does NOT move the document on a mapped failure', async () => {
    const onAssigned = vi.fn();
    const setError = vi.fn();

    await runProjectAssign({
      documentId: 5,
      nextId: 99,
      currentId: null,
      pending: false,
      assign: async (): Promise<AssignProjectOutcome> => ({
        ok: false,
        kind: 'not-found',
        message: 'That project is no longer available.',
      }),
      setPending: vi.fn(),
      setError,
      onAssigned,
    });

    expect(onAssigned).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('That project is no longer available.');
  });

  it('surfaces a message and clears pending when the fetch REJECTS (no wedge)', async () => {
    const onAssigned = vi.fn();
    const setPending = vi.fn();
    const setError = vi.fn();

    await runProjectAssign({
      documentId: 5,
      nextId: 10,
      currentId: null,
      pending: false,
      assign: async () => {
        throw new Error('network down');
      },
      setPending,
      setError,
      onAssigned,
    });

    expect(onAssigned).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('move'));
    expect(setPending).toHaveBeenLastCalledWith(false);
  });

  it('is a no-op when the chosen project is the current one', async () => {
    const assign = vi.fn();
    await runProjectAssign({
      documentId: 5,
      nextId: 10,
      currentId: 10,
      pending: false,
      assign,
      setPending: vi.fn(),
      setError: vi.fn(),
      onAssigned: vi.fn(),
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it('drops a press while an assignment is in flight', async () => {
    const assign = vi.fn();
    await runProjectAssign({
      documentId: 5,
      nextId: 10,
      currentId: null,
      pending: true,
      assign,
      setPending: vi.fn(),
      setError: vi.fn(),
      onAssigned: vi.fn(),
    });
    expect(assign).not.toHaveBeenCalled();
  });
});
