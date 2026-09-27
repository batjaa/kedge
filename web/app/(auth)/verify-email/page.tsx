import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { safeAuthNext } from '@/lib/auth-redirect';
import { VerifyEmailForm } from '@/components/auth/verify-email-form';

export const metadata: Metadata = { title: 'Confirm your email · Kedge' };
export default async function VerifyEmailPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  return <VerifyEmailForm verified={Boolean(session && session.email_verified !== false)} next={typeof params.next === 'string' ? safeAuthNext(params.next) : undefined} email={session?.user.email} status={typeof params.status === 'string' ? params.status : undefined} />;
}
