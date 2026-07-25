'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { signIn, signUp, type AuthOutcome } from '@/lib/auth-client';
import { signupEmailHandoffKey } from '@/lib/shared';

type Mode = 'signin' | 'signup';

// All visible copy lives in the `auth` catalog (M3.9 #124), keyed by mode
// (auth.signin.* / auth.signup.*); only the cross-link targets stay in code.
const ALT_HREF: Record<Mode, string> = {
  signin: '/signup',
  signup: '/signin',
};

// The OAuth bounce reasons with dedicated catalog copy (auth.oauthErrors.*).
// An unknown code degrades to the generic github_failed message.
const KNOWN_OAUTH_ERRORS = ['github_failed', 'github_no_verified_email'] as const;
type KnownOauthError = (typeof KNOWN_OAUTH_ERRORS)[number];

function knownOauthError(code: string): KnownOauthError {
  return (KNOWN_OAUTH_ERRORS as readonly string[]).includes(code)
    ? (code as KnownOauthError)
    : 'github_failed';
}

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
  githubHref,
  oauthError,
}: {
  mode: Mode;
  redirectTo?: string;
  expired?: boolean;
  /** GitHub redirect URL, present only when the API reports OAuth configured. */
  githubHref?: string;
  /** Error code from a bounced OAuth attempt (?error=… on the sign-in page). */
  oauthError?: string;
}) {
  const router = useRouter();
  const t = useTranslations('auth');
  const next = safeNext(redirectTo);
  const oauthMessage = oauthError
    ? t(`oauthErrors.${knownOauthError(oauthError)}`)
    : null;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // The landing's email CTA hands its address off through sessionStorage (never
  // the URL). Read once after mount — an effect, not a state initializer, so the
  // server render and first client render agree and hydration stays clean.
  useEffect(() => {
    if (mode !== 'signup') return;
    try {
      const handed = sessionStorage.getItem(signupEmailHandoffKey);
      if (handed) {
        sessionStorage.removeItem(signupEmailHandoffKey);
        setEmail((current) => current || handed);
      }
    } catch {
      // Storage unavailable: the visitor just types their email again.
    }
  }, [mode]);

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

    // outcome.message is API prose when the response carried one (passed through
    // untranslated per SPEC m3.9); otherwise fall back to catalog copy by kind.
    if (outcome.kind === 'validation') {
      setFieldErrors(outcome.errors);
      // Surface a top-level message only when it isn't already pinned to a field.
      if (Object.keys(outcome.errors).length === 0) {
        setFormError(outcome.message ?? t('errors.validation'));
      }
    } else {
      setFormError(
        outcome.message ??
          t(outcome.kind === 'rate-limited' ? 'errors.rateLimited' : 'errors.server'),
      );
    }
    setPending(false);
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
        {t(`${mode}.title`)}
      </h1>
      <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {t(`${mode}.subtitle`)}
      </p>

      <div className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-7">
        {expired ? (
          <p className="mb-5 rounded-xl bg-amber-400/10 px-3.5 py-2.5 text-sm text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300">
            {t('sessionExpired')}
          </p>
        ) : null}

        {oauthMessage ? (
          <p
            role="alert"
            className="mb-5 rounded-xl bg-rose-400/10 px-3.5 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300"
          >
            {oauthMessage}
          </p>
        ) : null}

        {githubHref ? (
          <>
            <a
              href={githubHref}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-zinc-100 px-3.5 py-2 text-sm font-medium text-zinc-900 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/5 dark:text-white dark:ring-white/10 dark:hover:bg-white/10"
            >
              <GitHubMark />
              {t('continueWithGithub')}
            </a>
            <div className="my-5 flex items-center gap-3" aria-hidden="true">
              <div className="h-px flex-1 bg-zinc-900/10 dark:bg-white/10" />
              <span className="text-xs text-zinc-400 dark:text-zinc-500">{t('or')}</span>
              <div className="h-px flex-1 bg-zinc-900/10 dark:bg-white/10" />
            </div>
          </>
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
              label={t('fields.name')}
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
            label={t('fields.email')}
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
            label={t('fields.password')}
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
            {pending ? t('working') : t(`${mode}.submit`)}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
        {t(`${mode}.altPrompt`)}{' '}
        <Link
          href={withNext(ALT_HREF[mode], next)}
          className="font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
        >
          {t(`${mode}.altLabel`)}
        </Link>
      </p>
    </div>
  );
}

function GitHubMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-current"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
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
