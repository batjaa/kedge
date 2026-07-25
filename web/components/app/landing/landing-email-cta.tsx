'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { signupEmailHandoffKey } from '@/lib/shared';

// The landing's email capture: the visitor leaves an email here and lands on
// /signup with it already filled in (AuthForm reads the handoff key on mount).
// The email travels via sessionStorage, never a query param — no PII in URLs,
// server logs, or history. Native validation only; the real validation is the
// signup form's job. Strings (label, placeholder, submit) read from the
// `landing` catalog (M3.9 #125) — the placeholder is an example address, so each
// locale seeds a natural-looking one.
export function LandingEmailCta() {
  const t = useTranslations('landing');
  const router = useRouter();
  const [email, setEmail] = useState('');

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();
    if (value) {
      try {
        sessionStorage.setItem(signupEmailHandoffKey, value);
      } catch {
        // Storage unavailable (private mode quirks): still route to signup.
      }
    }
    router.push('/signup');
  }

  // Localized submit labels (es/mn) run wider than the English original, so the
  // pill is responsive: stacked full-width controls below `sm`, the single
  // rounded-full pill from `sm` up (the register the design locked).
  return (
    <form onSubmit={onSubmit} aria-label={t('email.formLabel')} className="mt-8">
      <div className="mx-auto flex max-w-md flex-col gap-2 sm:flex-row sm:items-center sm:rounded-full sm:bg-white sm:p-1.5 sm:pl-4 sm:shadow-sm sm:ring-1 sm:ring-inset sm:ring-zinc-900/10 sm:focus-within:ring-2 sm:focus-within:ring-emerald-500 dark:sm:bg-white/5 dark:sm:ring-white/10">
        <label htmlFor="cta-email" className="sr-only">
          {t('email.emailLabel')}
        </label>
        <input
          id="cta-email"
          name="email"
          type="email"
          required
          inputMode="email"
          autoComplete="email"
          placeholder={t('email.placeholder')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-w-0 rounded-full bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-900/10 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 sm:flex-1 sm:rounded-none sm:bg-transparent sm:p-0 sm:shadow-none sm:ring-0 sm:focus:ring-0 dark:bg-white/5 dark:text-white dark:ring-white/10 dark:placeholder:text-zinc-500 dark:sm:bg-transparent dark:sm:ring-0"
        />
        <button
          type="submit"
          className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 sm:shrink-0 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15 dark:focus-visible:ring-offset-zinc-900"
        >
          {t('email.submit')}
        </button>
      </div>
    </form>
  );
}
