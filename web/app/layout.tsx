import { RootProvider } from 'fumadocs-ui/provider/next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import './global.css';

// DESIGN.md (Open Harbor): light-first, both themes always. System stacks for
// body/UI/prose; self-hosted Space Grotesk for display (see global.css). The
// default only applies with no stored choice — next-themes keeps a per-device
// pick (incl. dark) across every surface via localStorage.
//
// i18n (M3.9): the negotiated locale (cookie → Accept-Language → en-US, resolved
// in i18n/request.ts) drives `html lang`, which in turn triggers the mn-MN display
// font override in global.css. NextIntlClientProvider (no props) inherits locale +
// messages from the request config and forwards them to Client Components.
export default async function Layout({ children }: LayoutProps<'/'>) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <NextIntlClientProvider>
          <RootProvider theme={{ defaultTheme: 'light' }}>{children}</RootProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
