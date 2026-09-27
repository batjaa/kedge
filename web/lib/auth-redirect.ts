/** Keep all post-auth navigation on this origin, including browser URL normalization. */
export function safeAuthNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\\\x00-\x20]/.test(next)) return '/';

  // Auth routes cannot be useful return targets. Keeping one here would send a
  // just-confirmed user through another auth redirect (and can recreate the
  // verification gate when a stale next value is preserved by the browser).
  const pathname = next.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  if (pathname === '/verify-email' || pathname === '/signin' || pathname === '/signup') return '/';

  return next;
}

export function verificationPath(next: string): string {
  return `/verify-email?next=${encodeURIComponent(safeAuthNext(next))}`;
}
