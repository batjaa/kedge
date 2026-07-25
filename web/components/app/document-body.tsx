import { getTranslations } from 'next-intl/server';
import { renderMarkdown } from '@/lib/render-markdown';
import { renderMdx } from '@/lib/mdx';
import type { DocumentFormat } from '@/lib/document-types';

// The rendered body of an imported document, shared by the authenticated doc
// page and the public share page so both go through ONE render decision (SPEC
// §6.1). Three paths, never a crash:
//
//   - md / html            → the safe markdown renderer (raw HTML dropped).
//   - mdx, mdx_ok !== false → the hardened MDX pipeline (allowlist, sanitized
//                             raw HTML, unknown components → neutral box).
//   - mdx, mdx_ok === false → plain-markdown fallback + author-visible banner,
//                             decided at import so the page never recompiles a
//                             known-bad document to find out.
//
// renderMdx itself also degrades to markdown if a render-time compile ever
// disagrees with the stored mdx_ok — belt and braces, so this is total.

export async function DocumentBody({
  format,
  mdxOk,
  content,
}: {
  format: DocumentFormat;
  mdxOk: boolean | null;
  content: string;
}) {
  if (format !== 'mdx') {
    return <article className="prose max-w-none">{await renderMarkdown(content)}</article>;
  }

  if (mdxOk === false) {
    return (
      <>
        <MdxFallbackBanner />
        <article className="prose max-w-none">{await renderMarkdown(content)}</article>
      </>
    );
  }

  const { node, ok } = await renderMdx(content);
  return (
    <>
      {ok ? null : <MdxFallbackBanner />}
      <article className="prose max-w-none">{node}</article>
    </>
  );
}

/**
 * Author-visible degradation notice (SPEC §6.1). Amber = the DESIGN.md
 * pending/suggestion status hue; this is a graceful degradation, not an error.
 * Chrome only (M3.9 #126): the notice localizes; the document body it wraps
 * never does. Async so the string comes from the request locale's catalog.
 */
async function MdxFallbackBanner() {
  const t = await getTranslations('review');

  return (
    <div
      role="status"
      className="not-prose mb-6 flex items-start gap-3 rounded-2xl bg-amber-50/50 p-4 ring-1 ring-inset ring-amber-500/25 dark:bg-amber-500/5"
    >
      <span className="mt-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        {t('body.mdxBadge')}
      </span>
      <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        {t('body.mdxFallback')}
      </p>
    </div>
  );
}
