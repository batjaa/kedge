/** Keep all post-auth navigation on this origin, including browser URL normalization. */
export function safeAuthNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\\\x00-\x20]/.test(next)) return '/';
  return next;
}

export function verificationPath(next: string): string {
  return `/verify-email?next=${encodeURIComponent(safeAuthNext(next))}`;
}
