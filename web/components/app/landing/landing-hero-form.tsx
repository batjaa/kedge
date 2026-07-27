'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { sharePath, startDemo } from '@/lib/demo-client';
import { SampleDemoButton } from './landing-sample-demo';

// The hero's working paste box — the PLG wedge, unchanged in behaviour from the
// pre-landing DemoHome (SPEC §10.3, #25): paste a public URL, hit "Render it",
// and land on the freshly-minted share link the API hands back, zero signup.
// The demo import flow itself — rate limits, the SSRF guard, the CSRF-primed
// mutation — lives entirely in `startDemo` (lib/demo-client) and the API; this
// component only owns the field, the pending/error UI, and the same-origin
// navigation. Reused, never reimplemented.
//
// i18n (M3.9, #125): every visitor-facing string reads from the `landing`
// catalog. The placeholder URL and the format names (Markdown/MDX/HTML) are
// content, not chrome, and stay literal; an API error message (`outcome.message`)
// passes through untranslated (SPEC m3.9: API prose passes through as-is).
//
// Open Harbor register (docs/designs/variant-3-open-harbor.html): a single
// rounded-full pill with the solid-emerald hero CTA (DESIGN.md reserves that
// variant for hero/approve actions). Roles/labels are explicit and stable so the
// M1 demo journey (#26) and the landing journey drive it cleanly (those run
// under the default en-US context, so their English selectors still hold).
export function LandingHeroForm({ sampleUrl }: { sampleUrl?: string }) {
  const t = useTranslations('landing');
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    const outcome = await startDemo(url.trim());

    if (outcome.ok) {
      // The share URL is absolute (API's FRONTEND_URL); navigate by its path so
      // the SPA transition stays same-origin.
      router.push(sharePath(outcome.shareUrl));
      return;
    }

    setError(outcome.kind === 'disabled' ? t('demo.disabledError') : outcome.message);
    setPending(false);
  }

  const pillRing = error
    ? 'ring-rose-500/60 focus-within:ring-rose-500'
    : 'ring-zinc-900/10 focus-within:ring-emerald-500 dark:ring-white/10';

  return (
    <form onSubmit={onSubmit} noValidate aria-label={t('demo.formLabel')} className="mt-8">
      <label htmlFor="demo-url" className="sr-only">
        {t('demo.urlLabel')}
      </label>
      <div
        className={`flex max-w-md items-center gap-2 rounded-full bg-white p-1.5 pl-4 shadow-sm ring-1 ring-inset focus-within:ring-2 dark:bg-white/5 ${pillRing}`}
      >
        <input
          id="demo-url"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://github.com/org/repo/blob/main/SPEC.md"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            if (error) setError(null);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'demo-error' : 'demo-hint'}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-white dark:placeholder:text-zinc-500"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15 dark:focus-visible:ring-offset-zinc-900"
        >
          {pending ? t('demo.pending') : t('demo.submit')}
        </button>
      </div>

      {error ? (
        <p id="demo-error" role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : (
        <p id="demo-hint" className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          {/* Honest to the demo's contract: the anonymous endpoint accepts only
              public GitHub file links and raw Markdown/MDX/HTML URLs (private
              repos via PAT are a signed-in feature, so not advertised here). */}
          <span>{t('demo.hintSources')}</span>
          <span aria-hidden="true">·</span>
          <span>Markdown</span>
          <span aria-hidden="true">·</span>
          <span>MDX</span>
          <span aria-hidden="true">·</span>
          <span>HTML</span>
          <span aria-hidden="true">·</span>
          <span>{t('demo.hintDiagrams')}</span>
        </p>
      )}

      {/* The one-click path to the wow moment: no hunting for a URL before
          seeing a render. Dogfooding doubles as social proof. */}
      {sampleUrl ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          <span>{t('demo.sampleIntro')}</span>
          <SampleDemoButton url={sampleUrl} label={t('demo.sampleChip')} variant="chip" />
        </p>
      ) : null}
    </form>
  );
}
