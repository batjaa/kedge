import type { ReactNode } from 'react';
import type { MDXComponents } from 'mdx/types';
import { KrokiDiagram } from '@/components/kroki-diagram';

// The component allowlist for IMPORTED MDX (SPEC §6.1). Distinct from
// components/mdx.tsx (the Fumadocs dogfood surface): imported documents are
// untrusted, so this set is exactly what lib/remark-mdx-harden.ts permits —
// Callout / Note / Warning / CodeGroup / Tabs / KrokiDiagram — plus the neutral
// UnsupportedComponent the harden pass rewrites everything else into. Simple,
// server-rendered, Kedge-styled with DESIGN.md tokens (no client JS, no webfonts).

type Tone = 'info' | 'warning';

const TONE: Record<Tone, { ring: string; bg: string; label: string; labelText: string }> = {
  // Brand-accent info (the DESIGN.md "version callout" recipe).
  info: {
    ring: 'ring-emerald-500/20',
    bg: 'bg-emerald-50/50 dark:bg-emerald-500/5',
    label: 'text-emerald-700 dark:text-emerald-400',
    labelText: 'Note',
  },
  // Amber = the DESIGN.md "pending/suggestion" status hue, reused for warnings.
  warning: {
    ring: 'ring-amber-500/25',
    bg: 'bg-amber-50/50 dark:bg-amber-500/5',
    label: 'text-amber-700 dark:text-amber-400',
    labelText: 'Warning',
  },
};

function Admonition({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <aside className={`not-prose my-6 rounded-2xl p-4 ring-1 ring-inset ${t.ring} ${t.bg}`}>
      <p
        className={`mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide ${t.label}`}
      >
        {title ?? t.labelText}
      </p>
      <div className="prose prose-sm max-w-none text-zinc-700 dark:text-zinc-300">
        {children}
      </div>
    </aside>
  );
}

/** `<Callout type="info|warning" title="…">` — the general admonition. */
export function Callout({
  type,
  title,
  children,
}: {
  type?: string;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const tone: Tone = type === 'warning' || type === 'warn' || type === 'danger' ? 'warning' : 'info';
  return (
    <Admonition tone={tone} title={title}>
      {children}
    </Admonition>
  );
}

/** `<Note>` — info-toned admonition. */
export function Note({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <Admonition tone="info" title={title}>
      {children}
    </Admonition>
  );
}

/** `<Warning>` — amber-toned admonition. */
export function Warning({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <Admonition tone="warning" title={title}>
      {children}
    </Admonition>
  );
}

/**
 * `<CodeGroup title="…">` — a dark-panel wrapper around one or more code blocks.
 * Code-things stay dark in both themes (the DESIGN.md signature move). Static:
 * the language-tab interactivity is a later concern; the panels stack.
 */
export function CodeGroup({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl bg-zinc-900 ring-1 ring-white/10">
      {title ? (
        <div className="border-b border-white/5 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-zinc-400">
          {title}
        </div>
      ) : null}
      <div className="[&_pre]:!my-0 [&_pre]:!rounded-none [&_pre]:!bg-transparent [&_pre]:overflow-x-auto p-1 text-zinc-100">
        {children}
      </div>
    </div>
  );
}

/**
 * `<Tabs items={["A","B"]}>` — a simple titled container. Server-rendered with
 * no client state (M1): any `items` become label chips and the children render
 * stacked beneath. Interactivity is out of scope here.
 */
export function Tabs({ items, children }: { items?: unknown; children?: ReactNode }) {
  const labels = Array.isArray(items) ? items.filter((i) => typeof i === 'string') : [];
  return (
    <div className="not-prose my-6 rounded-2xl ring-1 ring-inset ring-zinc-900/10 dark:ring-white/10">
      {labels.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-b border-zinc-900/5 px-4 py-2 dark:border-white/5">
          {labels.map((label, i) => (
            <span
              key={i}
              className="rounded-full bg-zinc-100 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-500 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-400 dark:ring-white/10"
            >
              {label as string}
            </span>
          ))}
        </div>
      ) : null}
      <div className="prose prose-sm max-w-none px-4 py-2 text-zinc-700 dark:text-zinc-300">
        {children}
      </div>
    </div>
  );
}

/**
 * The neutral box the harden pass swaps in for any component outside the
 * allowlist (SPEC §6.1). Zinc, never error-styled — an unknown component is a
 * graceful gap, not a failure. Shows the original name so the author sees what
 * was dropped.
 */
export function UnsupportedComponent({ name }: { name?: string }) {
  return (
    <span className="not-prose my-2 inline-flex items-center gap-2 rounded-xl bg-zinc-50 px-3 py-1.5 align-middle ring-1 ring-inset ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        Unsupported component
      </span>
      <code className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
        {`<${name ?? 'Unknown'} />`}
      </code>
    </span>
  );
}

/**
 * The exact component map handed to compiled imported MDX. Only these names
 * exist; the harden pass guarantees the compiled module references nothing else.
 */
export const IMPORTED_MDX_COMPONENTS = {
  Callout,
  Note,
  Warning,
  CodeGroup,
  Tabs,
  KrokiDiagram,
  UnsupportedComponent,
} satisfies MDXComponents;
