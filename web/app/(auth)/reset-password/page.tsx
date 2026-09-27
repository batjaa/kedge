import type { Metadata } from 'next';
import { RecoveryForm } from '@/components/auth/recovery-form';

export const metadata: Metadata = { title: 'Reset password · Kedge', referrer: 'no-referrer' };
export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <RecoveryForm mode="reset" initialEmail={typeof params.email === 'string' ? params.email : ''} token={typeof params.token === 'string' ? params.token : ''} />;
}
