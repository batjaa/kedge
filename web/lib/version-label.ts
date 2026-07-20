import type { DocumentVersion } from './document-types';

export function versionLabel(version: Pick<DocumentVersion, 'id' | 'ordinal'> | null | undefined): string | null {
  if (!version) return null;

  return `v${version.ordinal ?? version.id}`;
}
