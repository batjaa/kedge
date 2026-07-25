import type { ReactNode } from 'react';
import { renderToStaticMarkup as reactRenderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/config';
import { loadMessages, type MessageTree } from '@/lib/i18n/messages';

// Drop-in replacement for react-dom/server's renderToStaticMarkup for the
// static-markup component tests (M3.9 #123): the app-chrome components read
// their strings via useTranslations, so a bare render throws "context not
// found". This wraps the node in NextIntlClientProvider with the REAL catalog
// from disk — en-US by default, any supported locale on request — so the
// assertions keep asserting the authored copy, not fixtures that could drift.
// Import it with the same name and only the import line changes per test file.

const cache = new Map<Locale, MessageTree>();

function messagesFor(locale: Locale): MessageTree {
  const cached = cache.get(locale);
  if (cached) return cached;
  const messages = loadMessages(locale);
  cache.set(locale, messages);
  return messages;
}

export function renderToStaticMarkup(
  node: ReactNode,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return reactRenderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MessageTree is the provider's AbstractIntlMessages shape
      messages={messagesFor(locale) as any}
      timeZone="UTC"
    >
      {node}
    </NextIntlClientProvider>,
  );
}
