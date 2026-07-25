import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
} from '@/lib/i18n/config';
import {
  flattenKeys,
  listNamespaces,
  loadMessages,
  readCatalog,
  type MessageTree,
} from '@/lib/i18n/messages';

// The CI key-parity guard (eng-review B1): every key en-US defines must exist in
// all four catalogs, in every namespace. Born here as the tracer's rot guard, it
// AUTOMATICALLY covers every namespace the later surface tickets add — it reads the
// namespace list from disk rather than hard-coding it.
const nonSourceLocales = SUPPORTED_LOCALES.filter(
  (locale): locale is Locale => locale !== DEFAULT_LOCALE,
);

describe('message catalog parity', () => {
  const namespaces = listNamespaces();

  it('discovers at least the tracer namespace', () => {
    expect(namespaces).toContain('app-shell');
  });

  for (const namespace of namespaces) {
    const enKeys = flattenKeys(
      (readCatalog(DEFAULT_LOCALE, namespace) ?? {}) as MessageTree,
    ).sort();

    it(`en-US/${namespace}.json is non-empty`, () => {
      expect(enKeys.length).toBeGreaterThan(0);
    });

    for (const locale of nonSourceLocales) {
      it(`${locale}/${namespace}.json has exactly the en-US key set`, () => {
        const catalog = readCatalog(locale, namespace);
        expect(
          catalog,
          `${locale} is missing the ${namespace} namespace file`,
        ).not.toBeNull();
        expect(flattenKeys(catalog as MessageTree).sort()).toEqual(enKeys);
      });
    }
  }
});

describe('loadMessages', () => {
  it('every locale resolves a value at every en-US key path (fallback baked in)', () => {
    const enPaths = new Set(
      listNamespaces().flatMap((ns) =>
        flattenKeys((readCatalog(DEFAULT_LOCALE, ns) ?? {}) as MessageTree).map(
          (key) => `${ns}.${key}`,
        ),
      ),
    );

    for (const locale of SUPPORTED_LOCALES) {
      const merged = loadMessages(locale);
      const mergedPaths = new Set(flattenKeys(merged));
      for (const path of enPaths) {
        expect(mergedPaths.has(path), `${locale} missing ${path}`).toBe(true);
      }
    }
  });
});
