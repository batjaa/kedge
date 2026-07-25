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

  return (
    <form onSubmit={onSubmit} aria-label={t('email.formLabel')} className="mt-8">
      <div className="mx-auto flex max-w-md items-center gap-2 rounded-full bg-white p-1.5 pl-4 shadow-sm ring-1 ring-inset ring-zinc-900/10 focus-within:ring-2 focus-within:ring-emerald-500 dark:bg-white/5 dark:ring-white/10">
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
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-white dark:placeholder:text-zinc-500"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15 dark:focus-visible:ring-offset-zinc-900"
        >
          {t('email.submit')}
        </button>
      </div>
    </form>
  );
}
