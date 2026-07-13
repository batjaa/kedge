import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { getCapabilities } from '@/lib/capabilities';
import { publicApiBaseUrl } from '@/lib/config';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Create your account · Kedge' };

export default async function SignUpPage({ searchParams }: PageProps<'/signup'>) {
  const params = await searchParams;
  const next = firstParam(params.next);

  if (await getSession()) redirect(safeNext(next));

  // GitHub sign-in doubles as sign-up (first click creates the account).
  const { github } = await getCapabilities();

  return (
    <AuthForm
      mode="signup"
      redirectTo={next}
      githubHref={github ? `${publicApiBaseUrl}/auth/github/redirect` : undefined}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeNext(next: string | undefined): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/';
}
