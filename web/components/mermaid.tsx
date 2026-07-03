'use client';

import { useEffect, useId, useState } from 'react';

// Mermaid rendering per SPEC §6.2: client-side ESM — private diagram source
// never leaves the browser. Theme-aware via the `dark` class on <html>.

function useIsDark() {
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const isDark = useIsDark();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isDark === null) return;
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'neutral',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        });
        const rendered = await mermaid.render(`mmd${id}${isDark ? 'd' : 'l'}`, chart);
        if (!cancelled) setSvg(rendered.svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, isDark, id]);

  // DESIGN.md failure rule: never crash — show the raw source instead
  if (failed) {
    return (
      <div className="not-prose my-6 rounded-2xl bg-rose-400/5 p-4 ring-1 ring-inset ring-rose-500/20">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase text-rose-600 dark:text-rose-400">
          mermaid — render failed, showing source
        </p>
        <pre className="overflow-x-auto font-mono text-xs text-zinc-600 dark:text-zinc-400">{chart}</pre>
      </div>
    );
  }

  return (
    <figure className="not-prose my-6 overflow-hidden rounded-2xl ring-1 ring-zinc-900/10 dark:ring-white/10">
      <div className="overflow-x-auto p-4">
        {svg ? (
          <div className="mx-auto w-fit" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="mx-auto h-24 w-2/3 animate-pulse rounded-xl bg-zinc-100 dark:bg-white/5" />
        )}
      </div>
      <figcaption className="border-t border-zinc-900/5 px-4 py-1.5 font-mono text-[10px] uppercase text-zinc-400 dark:border-white/5 dark:text-zinc-500">
        mermaid · rendered in your browser
      </figcaption>
    </figure>
  );
}
