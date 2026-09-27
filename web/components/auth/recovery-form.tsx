'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { requestPasswordReset, resetPassword } from '@/lib/auth-client';
import { Field } from './auth-form';

export const authButtonClass = 'w-full rounded-full bg-zinc-900 px-3.5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15';
export const authLinkClass = 'text-sm font-medium text-emerald-700 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-500 dark:text-emerald-400';

export function RecoveryForm({ mode, initialEmail = '', token = '' }: {
  mode: 'forgot' | 'reset'; initialEmail?: string; token?: string;
}) {
  const t = useTranslations('auth');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(null); setErrors({});
    const result = mode === 'forgot'
      ? await requestPasswordReset(email)
      : await resetPassword(email, token, password, confirmation);
    setPending(false);
    if (result.ok) { setSent(true); return; }
    if (result.kind === 'validation') {
      setErrors(result.errors);
      if (result.errors.token) setError(t('reset.invalid'));
      else if (!Object.keys(result.errors).length) setError(t('errors.validation'));
    } else setError(t(result.kind === 'rate-limited' ? 'errors.rateLimited' : 'errors.server'));
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{t(`${mode}.title`)}</h1>
      <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{t(`${mode}.subtitle`)}</p>
      <div className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-7">
        {sent ? <p role="status" className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">{t(`${mode}.success`)}</p> : (
          <form onSubmit={submit} className="space-y-5" aria-busy={pending}>
            {error ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}
            <Field id="email" label={t('fields.email')} type="email" autoComplete="email" value={email} onChange={setEmail} errors={errors.email} />
            {mode === 'reset' ? <>
              <Field id="password" label={t('fields.password')} type="password" autoComplete="new-password" value={password} onChange={setPassword} errors={errors.password} />
              <Field id="password_confirmation" label={t('fields.confirmPassword')} type="password" autoComplete="new-password" value={confirmation} onChange={setConfirmation} errors={errors.password_confirmation} />
            </> : null}
            <button type="submit" disabled={pending} className={authButtonClass}>{t(pending ? 'working' : `${mode}.submit`)}</button>
          </form>
        )}
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-3">
        <Link href="/signin" className={authLinkClass}>{t('backToSignIn')}</Link>
        {mode === 'reset' && !sent ? <Link href="/forgot-password" className={authLinkClass}>{t('reset.requestNew')}</Link> : null}
      </div>
    </div>
  );
}
