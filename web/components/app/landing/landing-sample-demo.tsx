'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { sharePath, startDemo } from '@/lib/demo-client';

// One-click sample demo: runs the existing anonymous demo-import flow against a
// known-good public URL (Kedge's own SPEC.md — dogfooding as proof). This is the
// zero-friction path to the product's wow moment: no hunting for a URL before
// seeing a render. Same startDemo contract as the hero paste box; only the
// trigger differs. The label arrives already translated from the call site
// (M3.9 #125); the pending/disabled strings read from the `landing` catalog,
// while an API error message passes through untranslated (SPEC m3.9).
export function SampleDemoButton({
  url,
  label,
  variant,
}: {
  url: string;
  label: string;
  variant: 'chip' | 'link';
}) {
  const t = useTranslations('landing');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (pending) return;
    setPending(true);
    setError(null);

    const outcome = await startDemo(url);

    if (outcome.ok) {
      router.push(sharePath(outcome.shareUrl));
      return;
    }

    setError(outcome.kind === 'disabled' ? t('demo.disabledError') : outcome.message);
    setPending(false);
  }

  const styles =
    variant === 'chip'
      ? 'rounded-full bg-white px-3 py-1 font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-stone-100 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10'
      : 'font-medium text-emerald-700 underline decoration-emerald-600/40 underline-offset-2 hover:decoration-emerald-600 dark:text-emerald-400 dark:decoration-emerald-400/40 dark:hover:decoration-emerald-400';

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={`${styles} focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60`}
      >
        {pending ? t('demo.pending') : label}
      </button>
      {error ? (
        <span role="alert" className="text-rose-600 dark:text-rose-400">
          {error}
        </span>
      ) : null}
    </>
  );
}
