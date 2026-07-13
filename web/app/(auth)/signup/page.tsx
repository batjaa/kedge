import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Create your account · Kedge' };

export default async function SignUpPage({ searchParams }: PageProps<'/signup'>) {
  const params = await searchParams;
  const next = firstParam(params.next);

  if (await getSession()) redirect(safeNext(next));

  return <AuthForm mode="signup" redirectTo={next} />;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeNext(next: string | undefined): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/';
}
