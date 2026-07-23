import type { DocumentListItem, ProjectRef } from './document-types';

/** One project group on the home list — a project (or Unfiled) and its rows. */
export interface DocumentGroup {
  /** The project, or null for the Unfiled bucket. */
  project: ProjectRef | null;
  items: DocumentListItem[];
}

/**
 * The canonical project ordering (14A): alphabetical by name, case-insensitive,
 * with the id as a stable tiebreaker so equal names never reshuffle between
 * renders. Shared by the home's group headers and its chip/selector list so both
 * read the same order.
 */
export function compareProjectsByName(
  a: { name: string; id: number },
  b: { name: string; id: number },
): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id;
}

/**
 * Group the home list by project (SPEC 11 + decision 14A). Named project groups
 * come first, alphabetical by name (case-insensitive, id as a stable tiebreaker
 * so equal names never reshuffle between renders); the Unfiled bucket — the
 * absence of a project, never a row — is always last, and only when it has rows.
 * Row order within a group is preserved (the list's newest-first ordering).
 */
export function groupDocumentsByProject(items: DocumentListItem[]): DocumentGroup[] {
  const named = new Map<number, DocumentGroup>();
  const unfiled: DocumentListItem[] = [];

  for (const item of items) {
    if (item.project) {
      const group = named.get(item.project.id);
      if (group) {
        group.items.push(item);
      } else {
        named.set(item.project.id, { project: item.project, items: [item] });
      }
    } else {
      unfiled.push(item);
    }
  }

  const groups = [...named.values()].sort((a, b) => compareProjectsByName(a.project!, b.project!));

  // Unfiled always last (14A), and only when it actually holds rows.
  if (unfiled.length > 0) {
    groups.push({ project: null, items: unfiled });
  }

  return groups;
}

/**
 * Whether the grouped list should render project headers. A workspace with no
 * project assigned reads as a single implicit group — the home looks exactly as
 * it did before projects existed (no headers). Headers appear the moment any row
 * carries a project.
 */
export function hasNamedGroups(groups: DocumentGroup[]): boolean {
  return groups.some((group) => group.project !== null);
}
