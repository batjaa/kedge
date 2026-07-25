import { describe, expect, it } from 'vitest';
import { parse } from '@formatjs/icu-messageformat-parser';
import { createTranslator } from 'use-intl/core';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n/config';
import {
  flattenKeys,
  listNamespaces,
  loadMessages,
  readCatalog,
  type MessageTree,
} from '@/lib/i18n/messages';

// ICU correctness for the app-chrome catalogs (M3.9 #123).
//
//   • Every leaf in every locale must PARSE as ICU MessageFormat — a stray
//     brace or a broken plural in a machine-seeded catalog would otherwise
//     surface as a runtime render error in exactly one locale (the kind of rot
//     the en-US-only dev loop never sees).
//   • Plurals format through CLDR per locale — including Mongolian (rules:
//     one = n=1, other otherwise), the founder's locale and the reason ICU
//     owns pluralization here instead of `count === 1` ternaries.
//   • Whole-sentence activity messages assemble in each language's own word
//     order via select + rich tags, and ICU date arguments localize.

function leafValue(tree: MessageTree, key: string): string {
  return key
    .split('.')
    .reduce<MessageTree | string>((node, part) => (node as MessageTree)[part], tree) as string;
}

describe('ICU syntax (all locales, all namespaces)', () => {
  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale}: every catalog string parses as ICU MessageFormat`, () => {
      for (const namespace of listNamespaces()) {
        const catalog = readCatalog(locale, namespace);
        expect(catalog, `${locale}/${namespace}.json missing`).not.toBeNull();

        for (const key of flattenKeys(catalog as MessageTree)) {
          const message = leafValue(catalog as MessageTree, key);
          expect(
            () => parse(message),
            `${locale}/${namespace}.json → ${key} is not valid ICU: ${message}`,
          ).not.toThrow();
        }
      }
    });
  }
});

function translatorFor(locale: Locale) {
  return createTranslator({
    locale,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catalog tree as AbstractIntlMessages
    messages: loadMessages(locale) as any,
  });
}

describe('ICU plurals per locale (CLDR)', () => {
  it('en-US inflects the rail doc count', () => {
    const t = translatorFor('en-US');
    expect(t('dashboard.rail.docs', { count: 1 })).toBe('1 doc');
    expect(t('dashboard.rail.docs', { count: 2 })).toBe('2 docs');
  });

  it('es-US inflects import warnings', () => {
    const t = translatorFor('es-US');
    expect(t('imports.warnings.count', { count: 1 })).toContain('advertencia');
    expect(t('imports.warnings.count', { count: 3 })).toContain('advertencias');
  });

  it('de-DE inflects unchanged-file counts', () => {
    const t = translatorFor('de-DE');
    expect(t('tracked-repos.report.filesUnchanged', { count: 1 })).toContain('1 Datei unverändert');
    expect(t('tracked-repos.report.filesUnchanged', { count: 4 })).toContain('4 Dateien unverändert');
  });

  it('mn-MN selects CLDR one/other (one = exactly 1; 21 is other, unlike Slavic rules)', () => {
    const t = translatorFor('mn-MN');
    // Mongolian nouns don't inflect for these counts — the point is that the
    // plural ARGUMENT resolves through CLDR without error for the mn rules,
    // and the formatted number lands inside the sentence.
    expect(t('dashboard.stats.documents', { count: 1 })).toBe('баримт');
    expect(t('dashboard.rail.docs', { count: 21 })).toBe('21 баримт');
    expect(t('dashboard.rail.orphans', { count: 101 })).toContain('101');
  });
});

describe('whole-sentence activity messages (select + rich tags)', () => {
  const values = (name: string | null, label: string) => ({
    actor: name ? 'named' : 'system',
    name: name ?? '',
    person: (chunks: string) => chunks,
    target: () => label,
  });

  it('es-US puts the actor into the sentence in Spanish word order', () => {
    const t = translatorFor('es-US');
    const html = t.markup('activity.sentence.commentCreated', values('Ana', 'RFC-017'));
    expect(html).toBe('Ana comentó en RFC-017');
  });

  it('de-DE moves the verb to the end (never English glue)', () => {
    const t = translatorFor('de-DE');
    const html = t.markup('activity.sentence.documentImported', values('Jonas', 'SPEC'));
    expect(html).toBe('Jonas hat SPEC importiert');
  });

  it('a system row (null actor) reads as its own branch, not a blank name', () => {
    const t = translatorFor('en-US');
    const html = t.markup('activity.sentence.commentCreated', values(null, 'RFC-017'));
    expect(html).toBe('Commented on RFC-017');
    expect(html).not.toContain('  ');
  });

  it('mn-MN renders the gone-stale plural sentence with the count embedded', () => {
    const t = translatorFor('mn-MN');
    const html = t.markup('activity.sentence.approvalsGoneStale', {
      ...values(null, 'SPEC'),
      count: 3,
    });
    expect(html).toContain('3');
    expect(html).toContain('SPEC');
  });

  it('the import-failed sentence carries API reason prose through untranslated', () => {
    const t = translatorFor('de-DE');
    const html = t.markup('activity.sentence.importFailed', {
      ...values(null, 'SPEC'),
      hasReason: 'yes',
      reason: 'upstream returned 404',
    });
    expect(html).toContain('fehlgeschlagen');
    expect(html).toContain('upstream returned 404');
  });
});

describe('ICU date arguments localize', () => {
  const date = new Date('2026-07-24T12:00:00Z');

  it('renders the connected-at date per locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const t = translatorFor(locale);
      const formatted = t('settings.integrations.connectedAt', { date });
      expect(formatted, `${locale} produced an empty date line`).toContain('2026');
    }
  });

  it('is not the same string across locales (actually localized)', () => {
    const en = translatorFor('en-US')('settings.integrations.connectedAt', {
      date,
    });
    const de = translatorFor('de-DE')('settings.integrations.connectedAt', {
      date,
    });
    expect(en).not.toBe(de);
  });
});

describe('screen-reader announcements interpolate the untranslated title', () => {
  it('all four locales carry the document title verbatim', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const t = translatorFor(locale);
      const message = t('documents.announce.ready', { title: 'Тест SPEC ← 100%' });
      expect(message).toContain('Тест SPEC ← 100%');
    }
  });
});
