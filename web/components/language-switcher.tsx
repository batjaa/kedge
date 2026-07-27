'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocale } from '@/lib/i18n/actions';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n/config';

// The one reusable language switcher (M3.9). Lives in the app header now (#122);
// #124 places it on the shared-doc surface and #125 in the landing footer — hence
// a self-contained, surface-agnostic export. Works for signed-in AND anonymous
// visitors: it only sets a cookie via a server action, independent of the session.
//
// Endonyms are shown in their OWN language and are therefore NOT translated (a
// Spanish speaker looks for "Español", not "Spanish"); only the accessible label
// comes from the catalog. Current selection reflects the negotiated locale via
// useLocale (request-config context), not a client-side cookie read.
const LOCALE_ENDONYMS: Record<Locale, string> = {
  'en-US': 'English',
  'es-US': 'Español',
  'mn-MN': 'Монгол',
  'de-DE': 'Deutsch',
};

export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const t = useTranslations('app-shell');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    startTransition(async () => {
      await setLocale(next);
      // Re-run the server render so every surface re-reads the new cookie locale.
      router.refresh();
    });
  }

  return (
    <label className="relative flex items-center">
      <span className="sr-only">{t('switcher.label')}</span>
      <select
        value={locale}
        onChange={onChange}
        disabled={pending}
        aria-label={t('switcher.label')}
        className="h-8 cursor-pointer rounded-md bg-transparent py-0 pl-2 pr-6 text-sm text-zinc-600 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-white/5"
      >
        {SUPPORTED_LOCALES.map((option) => (
          <option key={option} value={option} className="text-zinc-900">
            {LOCALE_ENDONYMS[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
