import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { BrandMark } from '@/components/brand-mark';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

// Public chrome for share links (SPEC 10.2): a thin header (wordmark + language
// switcher + theme toggle) and nothing else — no authenticated shell, no nav.
// These pages sit outside the Fumadocs layouts, so this wrapper owns the page
// background.
//
// The language switcher is here deliberately (SPEC m3.9, story 3 / eng-review
// 4A): an invited reviewer on a share link has no account, so the shared-doc
// surface must offer the same cookie-backed switcher as the app header — it
// only sets a cookie via a server action, no auth involved.
//
// `noindex` for the whole /shared subtree: a "private link" (the read surface
// and the friendly gone page alike) must never enter a search index. This sets
// the <meta name="robots"> tag; the matching X-Robots-Tag HTTP header is set in
// next.config.mjs so crawlers see it even without executing the page.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SharedLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('shared');
  return (
    <div className="flex min-h-screen flex-col bg-stone-50 dark:bg-zinc-900">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-900/10 bg-stone-50/85 px-6 backdrop-blur dark:border-white/10 dark:bg-zinc-900/85">
        <BrandMark />
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-zinc-900/10 px-6 py-4 text-center dark:border-white/10">
        <a
          href="/"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          {t('footerCta')}
        </a>
      </footer>
    </div>
  );
}
