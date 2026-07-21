import { describe, expect, it } from 'vitest';
import { readCollapsePreference, writeCollapsePreference } from '@/lib/collapse-preference';

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    store,
  };
}

describe('readCollapsePreference', () => {
  it('defaults to expanded when nothing is stored', () => {
    expect(readCollapsePreference(memoryStorage(), 'kedge:review:rail-collapsed')).toBe(false);
  });

  it('round-trips the collapsed flag', () => {
    const storage = memoryStorage();

    writeCollapsePreference(storage, 'kedge:review:rail-collapsed', true);
    expect(readCollapsePreference(storage, 'kedge:review:rail-collapsed')).toBe(true);

    writeCollapsePreference(storage, 'kedge:review:rail-collapsed', false);
    expect(readCollapsePreference(storage, 'kedge:review:rail-collapsed')).toBe(false);
  });

  it('treats unknown stored values as expanded', () => {
    const storage = memoryStorage({ 'kedge:review:sidebar-collapsed': 'yes' });
    expect(readCollapsePreference(storage, 'kedge:review:sidebar-collapsed')).toBe(false);
  });

  it('survives a storage that throws (private mode)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };

    expect(readCollapsePreference(throwing, 'k')).toBe(false);
    expect(() => writeCollapsePreference(throwing, 'k', true)).not.toThrow();
  });

  it('tolerates a missing storage entirely', () => {
    expect(readCollapsePreference(null, 'k')).toBe(false);
    expect(() => writeCollapsePreference(null, 'k', true)).not.toThrow();
  });
});
