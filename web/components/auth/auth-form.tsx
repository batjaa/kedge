'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { signIn, signUp, type AuthOutcome } from '@/lib/auth-client';

type Mode = 'signin' | 'signup';

const COPY = {
  signin: {
    title: 'Sign in',
    subtitle: 'Welcome back. Pick up your reviews where you left off.',
    submit: 'Sign in',
    altPrompt: 'New to Kedge?',
    altLabel: 'Create an account',
    altHref: '/signup',
  },
  signup: {
    title: 'Create your account',
    subtitle: 'Start reviewing specs with comments that keep their place.',
    submit: 'Create account',
    altPrompt: 'Already have an account?',
    altLabel: 'Sign in',
    altHref: '/signin',
  },
} as const;

// Only allow same-origin, non-protocol-relative return paths (no open redirects).
function safeNext(next: string | undefined): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/';
}

function withNext(href: string, next: string): string {
  return next === '/' ? href : `${href}?next=${encodeURIComponent(next)}`;
}

export function AuthForm({
  mode,
  redirectTo,
  expired,
}: {
  mode: Mode;
  redirectTo?: string;
  expired?: boolean;
}) {
  const router = useRouter();
  const copy = COPY[mode];
  const next = safeNext(redirectTo);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function clearFieldError(field: string) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const nextErrors = { ...prev };
      delete nextErrors[field];
      return nextErrors;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setFormError(null);
    setFieldErrors({});

    const outcome: AuthOutcome =
      mode === 'signin'
        ? await signIn(email, password)
        : await signUp(name, email, password);

    if (outcome.ok) {
      // Cookie is set; land on the requested page and refresh so the server
      // guard re-reads the now-authenticated session.
      router.replace(next);
      router.refresh();
      return;
    }

    if (outcome.kind === 'validation') {
      setFieldErrors(outcome.errors);
      // Surface a top-level message only when it isn't already pinned to a field.
      if (Object.keys(outcome.errors).length === 0) setFormError(outcome.message);
    } else {
      setFormError(outcome.message);
    }
    setPending(false);
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
        {copy.title}
      </h1>
      <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {copy.subtitle}
      </p>

      <div className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-7">
        {expired ? (
          <p className="mb-5 rounded-xl bg-amber-400/10 px-3.5 py-2.5 text-sm text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300">
            Your session expired. Please sign in again.
          </p>
        ) : null}

        {formError ? (
          <p
            role="alert"
            className="mb-5 rounded-xl bg-rose-400/10 px-3.5 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300"
          >
            {formError}
          </p>
        ) : null}

        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {mode === 'signup' ? (
            <Field
              id="name"
              label="Name"
              type="text"
              autoComplete="name"
              value={name}
              errors={fieldErrors.name}
              onChange={(v) => {
                setName(v);
                clearFieldError('name');
              }}
            />
          ) : null}

          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            errors={fieldErrors.email}
            onChange={(v) => {
              setEmail(v);
              clearFieldError('email');
            }}
          />

          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            errors={fieldErrors.password}
            onChange={(v) => {
              setPassword(v);
              clearFieldError('password');
            }}
          />

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-full bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
          >
            {pending ? 'Working…' : copy.submit}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
        {copy.altPrompt}{' '}
        <Link
          href={withNext(copy.altHref, next)}
          className="font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
        >
          {copy.altLabel}
        </Link>
      </p>
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  autoComplete,
  errors,
  onChange,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  autoComplete: string;
  errors?: string[];
  onChange: (value: string) => void;
}) {
  const invalid = Boolean(errors && errors.length > 0);
  const errorId = `${id}-error`;

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        className={`mt-1.5 w-full rounded-xl bg-white px-3.5 py-2 text-sm text-zinc-900 shadow-none ring-1 ring-inset placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 dark:bg-white/[.03] dark:text-white ${
          invalid
            ? 'ring-rose-500/50 focus-visible:ring-rose-500'
            : 'ring-zinc-900/10 focus-visible:ring-emerald-500 dark:ring-white/10'
        }`}
      />
      {invalid ? (
        <p id={errorId} className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">
          {errors![0]}
        </p>
      ) : null}
    </div>
  );
}
