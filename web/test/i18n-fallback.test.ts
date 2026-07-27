import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { deepMerge, missingKeys, type MessageTree } from '@/lib/i18n/messages';

// The en-US deep-merge fallback (eng-review B1): a key missing from a locale must
// render the English string, never a raw key path.
describe('en-US fallback', () => {
  const en: MessageTree = {
    nav: { documents: 'Documents', queue: 'Queue' },
    actions: { import: 'Import', signOut: 'Sign out' },
  };

  it('deep-merge keeps the English value where a locale omits a key', () => {
    // A partial locale: it translated `nav.queue` and `actions.import`, but is
    // missing `nav.documents` and `actions.signOut`.
    const partial: MessageTree = {
      nav: { queue: 'Warteschlange' },
      actions: { import: 'Importieren' },
    };
    expect(deepMerge(en, partial)).toEqual({
      nav: { documents: 'Documents', queue: 'Warteschlange' },
      actions: { import: 'Importieren', signOut: 'Sign out' },
    });
  });

  it('an explicit empty string is a translation, not a gap', () => {
    expect(deepMerge(en, { nav: { documents: '' } })).toMatchObject({
      nav: { documents: '' },
    });
  });

  it('reports the key paths a locale is missing (dev-log / parity signal)', () => {
    expect(
      missingKeys(en, { nav: { queue: 'Warteschlange' } }).sort(),
    ).toEqual(['actions.import', 'actions.signOut', 'nav.documents']);
    expect(missingKeys(en, en)).toEqual([]);
  });

  it('renders the English string, not the key path, for a missing key', () => {
    const merged = deepMerge(en, { nav: { queue: 'Warteschlange' } });
    // Cast to a plain lookup: next-intl's key generic derives from a global
    // IntlMessages augmentation this project doesn't declare, so untyped here.
    // The assertion under test is the runtime resolution, not compile-time keys.
    const t = createTranslator({
      locale: 'de-DE',
      messages: { 'app-shell': merged },
      namespace: 'app-shell',
    }) as unknown as (key: string) => string;

    // Present in the locale → German.
    expect(t('nav.queue')).toBe('Warteschlange');
    // Absent in the locale → English fallback, and crucially NOT the key path
    // "app-shell.nav.documents".
    expect(t('nav.documents')).toBe('Documents');
    expect(t('actions.signOut')).toBe('Sign out');
  });
});
