'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { safeAuthNext } from '@/lib/auth-redirect';
import { resendConfirmation, signOut } from '@/lib/auth-client';
import { authButtonClass, authLinkClass } from './recovery-form';

export function VerifyEmailForm({ email, status, verified, next }: { email?: string; status?: string; verified: boolean; next?: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!verified) return;
    let target = next;
    try {
      target ??= sessionStorage.getItem('kedge.auth.next') ?? undefined;
      sessionStorage.removeItem('kedge.auth.next');
    } catch { /* Optional continuity. */ }
    router.replace(safeAuthNext(target));
    router.refresh();
  }, [verified, next, router]);
  async function resend() {
    if (pending) return;
    setPending(true); setMessage(null); setError(null);
    const result = await resendConfirmation();
    setPending(false);
    if (result.ok) setMessage(t('verify.sent'));
    else setError(t(result.kind === 'rate-limited' ? 'errors.rateLimited' : 'errors.server'));
  }
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{t(status === 'verified' && !email ? 'verify.confirmedTitle' : 'verify.title')}</h1>
      <div className="mt-6 space-y-5 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-7">
        <p className="break-words text-sm leading-6 text-zinc-600 dark:text-zinc-400">{email ? t('verify.subtitle', { email }) : t(status === 'verified' ? 'verify.confirmed' : 'verify.signIn')}</p>
        {status === 'invalid' ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{t('verify.invalid')}</p> : null}
        {error ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}
        {message ? <p role="status" className="text-sm text-zinc-700 dark:text-zinc-300">{message}</p> : null}
        {email ? <>
          <button onClick={() => { setMessage(t('verify.checkAgain')); router.refresh(); }} className={authButtonClass}>{t('verify.continue')}</button>
          <button onClick={resend} disabled={pending} className={`${authLinkClass} w-full disabled:opacity-60`}>{t(pending ? 'working' : 'verify.resend')}</button>
        </> : <Link href="/signin" className={authLinkClass}>{t('backToSignIn')}</Link>}
      </div>
      {email ? <button className={`${authLinkClass} mt-6 w-full`} onClick={async () => { await signOut(); router.replace('/signin'); router.refresh(); }}>{t('verify.signOut')}</button> : null}
    </div>
  );
}
