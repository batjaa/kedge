import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME } from '@/lib/i18n/config';
import { negotiateLocale } from '@/lib/i18n/negotiate';
import {
  loadMessages,
  missingKeys,
  readCatalog,
  listNamespaces,
} from '@/lib/i18n/messages';

// The next-intl request config (documented "without i18n routing" mode — cookie
// locale, no URL prefixes). Runs per request on the server. Resolves the active
// locale (eng-review 4A) and returns the merged message tree with en-US fallback
// baked in (eng-review B1), so getTranslations()/useTranslations() everywhere
// speak the negotiated language and never surface a raw key.
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  const locale = negotiateLocale({
    cookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });

  // Dev-time missing-key logging (B1): the deep-merge means the runtime never
  // sees a gap, so surface it here instead — every key en-US defines that this
  // locale's OWN catalog omits, per namespace. CI's parity test is the hard gate;
  // this is the fast local signal while authoring a catalog.
  if (process.env.NODE_ENV !== 'production' && locale !== DEFAULT_LOCALE) {
    for (const namespace of listNamespaces()) {
      const base = readCatalog(DEFAULT_LOCALE, namespace) ?? {};
      const candidate = readCatalog(locale, namespace) ?? {};
      const gaps = missingKeys(base, candidate);
      if (gaps.length > 0) {
        console.warn(
          `[i18n] ${locale}/${namespace}.json missing ${gaps.length} key(s), ` +
            `falling back to en-US: ${gaps.join(', ')}`,
        );
      }
    }
  }

  return { locale, messages: loadMessages(locale) };
});
