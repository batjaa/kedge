'use client';

import { useCallback, useEffect, useState } from 'react';

// Per-device persistence for the review surface's collapsible columns (TOC
// sidebar, thread rail). Reads lazily after mount so the server render always
// matches the first client render (both columns expanded) — the stored
// preference is applied in an effect, never during hydration.

export function readCollapsePreference(storage: Pick<Storage, 'getItem'> | null, key: string): boolean {
  try {
    return storage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeCollapsePreference(storage: Pick<Storage, 'setItem'> | null, key: string, collapsed: boolean): void {
  try {
    storage?.setItem(key, collapsed ? '1' : '0');
  } catch {
    // Storage can be unavailable (private mode, quota) — the toggle still
    // works for the session, it just won't stick.
  }
}

export function useCollapsePreference(key: string): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(readCollapsePreference(window.localStorage, key));
  }, [key]);

  const update = useCallback((next: boolean) => {
    setCollapsed(next);
    writeCollapsePreference(window.localStorage, key, next);
  }, [key]);

  return [collapsed, update];
}
