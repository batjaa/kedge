import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCatalog, flattenKeys, type MessageTree } from '@/lib/i18n/messages';
import { SUPPORTED_LOCALES } from '@/lib/i18n/config';

// The chip-glossary length lint (M3.9 eng-review 13A; SPEC Testing Decisions).
// Chips are labels, not prose: every string in chips.json renders inside a
// small uppercase mono chip that clamps at 16ch (the truncation safety class).
// The catalog's translator-facing _notes declare a 15-character budget; this
// test makes the budget a CI fact for German — the locale 13A singles out
// ("OFFEN", "PRÜFUNG" style) because its compounds run long — so the longest
// German chip string provably fits inside the clamp and the belt-and-braces
// class never actually bites.

/** Must match the budget documented in each locale's chips.json `_notes.budget`
 *  and messages/README.md; the CSS clamp is max-w-[16ch] (one char of slack). */
const CHIP_BUDGET_CHARS = 15;

/** Leaf entries of a catalog, excluding the translator-facing _notes block. */
function chipLabels(tree: MessageTree): Array<[string, string]> {
  const { _notes, ...labels } = tree as { _notes?: MessageTree } & MessageTree;
  return flattenKeys(labels).map((key) => {
    const value = key
      .split('.')
      .reduce<MessageTree | string>((node, part) => (node as MessageTree)[part], labels);
    return [key, value as string];
  });
}

describe('chip glossary (13A)', () => {
  it('every de-DE chip label fits the truncation budget', () => {
    const catalog = readCatalog('de-DE', 'chips');
    expect(catalog).not.toBeNull();

    const labels = chipLabels(catalog as MessageTree);
    expect(labels.length).toBeGreaterThan(0);

    for (const [key, label] of labels) {
      expect(
        label.length,
        `de-DE chips.${key} = "${label}" (${label.length} chars) exceeds the ` +
          `${CHIP_BUDGET_CHARS}-char chip budget — pick a shorter German label ` +
          `(OFFEN/PRÜFUNG style), never let the truncation clamp bite`,
      ).toBeLessThanOrEqual(CHIP_BUDGET_CHARS);
    }
  });

  it('the longest de-DE chip string fits the budget (the 13A headline check)', () => {
    const labels = chipLabels(readCatalog('de-DE', 'chips') as MessageTree);
    const longest = labels.reduce((a, b) => (b[1].length > a[1].length ? b : a));

    expect(longest[1].length).toBeLessThanOrEqual(CHIP_BUDGET_CHARS);
  });

  it('every locale ships the glossary with translator notes', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = readCatalog(locale, 'chips') as MessageTree;
      expect(catalog, `${locale}/chips.json missing`).not.toBeNull();
      expect(catalog._notes, `${locale}/chips.json lost its _notes block`).toBeDefined();
      const notes = catalog._notes as MessageTree;
      expect(String(notes.budget)).toContain(String(CHIP_BUDGET_CHARS));
    }
  });

  it('the truncation safety class rides every chip surface (belt-and-braces)', () => {
    // The CSS half of 13A: the glossary is budgeted, and the clamp exists so a
    // future over-budget string degrades to an ellipsis instead of stretching
    // the row. Assert the class is present in the chip sources so a restyle
    // can't silently drop it.
    const root = process.cwd();
    for (const file of [
      'components/app/status-chip.tsx',
      'components/app/source-chip.tsx',
      'lib/tracked-repo-styles.ts',
    ]) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      expect(source, `${file} lost the max-w-[16ch] truncation clamp`).toContain('max-w-[16ch]');
      expect(source, `${file} lost the truncate class`).toContain('truncate');
    }
  });
});
