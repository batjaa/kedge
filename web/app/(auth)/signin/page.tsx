import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { getCapabilities } from '@/lib/capabilities';
import { publicApiBaseUrl } from '@/lib/config';
import { getSession } from '@/lib/session';
import { safeAuthNext, verificationPath } from '@/lib/auth-redirect';

export const metadata: Metadata = { title: 'Sign in · Kedge' };

export default async function SignInPage({ searchParams }: PageProps<'/signin'>) {
  const params = await searchParams;
  const next = firstParam(params.next);

  // Already signed in? Skip the form and go where they were headed.
  const session = await getSession();
  if (session) redirect(session.email_verified === false ? verificationPath(safeNext(next)) : safeNext(next));

  // The GitHub button appears only when the API reports OAuth configured.
  const { github } = await getCapabilities();

  return (
    <AuthForm
      mode="signin"
      redirectTo={next}
      expired={params.expired === '1'}
      githubHref={github ? `${publicApiBaseUrl}/auth/github/redirect` : undefined}
      oauthError={firstParam(params.error)}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeNext(next: string | undefined): string {
  return safeAuthNext(next);
}
