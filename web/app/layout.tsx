import { RootProvider } from 'fumadocs-ui/provider/next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from '@/lib/i18n/config';
import { loadMessages } from '@/lib/i18n/messages';
import './global.css';

// DESIGN.md (Open Harbor): light-first, both themes always. System stacks for
// body/UI/prose; self-hosted Space Grotesk for display (see global.css). The
// default only applies with no stored choice — next-themes keeps a per-device
// pick (incl. dark) across every surface via localStorage.
//
// i18n (M3.9): the negotiated locale (cookie → Accept-Language → en-US, resolved
// in i18n/request.ts) drives `html lang`, which in turn triggers the mn-MN display
// font override in global.css. NextIntlClientProvider forwards locale + messages to
// Client Components.
//
// The `/docs` dogfood shell is deliberately OUT of i18n scope (SPEC m3.9 Out of
// Scope): its content is Kedge's own English markdown, so it stays en-US — English
// prose must never be labelled `lang="mn-MN"` (wrong for screen readers) nor have
// its display font swapped. Every other surface follows the negotiated locale. The
// requested path comes from the header proxy.ts already sets for the auth guard.
export default async function Layout({ children }: LayoutProps<'/'>) {
  const pathname = (await headers()).get('x-kedge-pathname') ?? '';
  const isDocsShell = /^\/docs(?:[/?]|$)/.test(pathname);
  const negotiated = await getLocale();
  // getLocale() is typed as string; the request config only ever returns a
  // supported locale, but narrow defensively so a stray value falls back to en-US.
  const locale: Locale =
    isDocsShell || !isSupportedLocale(negotiated) ? DEFAULT_LOCALE : negotiated;

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
          <RootProvider theme={{ defaultTheme: 'light' }}>{children}</RootProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
