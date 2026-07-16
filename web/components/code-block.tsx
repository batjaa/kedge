import type { ReactNode } from 'react';

// The dark code panel for fenced code blocks in IMPORTED documents (issue #48).
//
// Both imported-doc render paths — lib/render-markdown (.md/.html and the MDX
// fallback) and lib/mdx (.mdx) — emit a fenced block as a bare <pre><code>
// inside <article class="prose">. Fumadocs' typography plugin gives every
// <code> an inline "pill" (border + muted background + radius, sized for inline
// code). On a multi-line block that <code> is still `display: inline`, so with
// the surrounding <pre> preserving newlines the pill repaints once PER WRAPPED
// LINE — the block reads as a stack of detached one-line fragments (#48). The
// dogfood docs escape this only because Fumadocs renders their fences through
// its own Shiki CodeBlock, which the untrusted imported-doc path deliberately
// does not use.
//
// The fix is one contiguous DESIGN.md code panel:
//   - `not-prose` opts the whole subtree out of the typography pill. Fumadocs
//     wraps every prose selector in `:not(:where([class~="not-prose"] *))`, so
//     the inner <code> no longer gets an inline background/border and the block
//     renders as a single surface with its newlines intact.
//   - The dark zinc-900 panel (ring-white/10, shadow-md, rounded-2xl, zinc-300
//     mono `text-xs leading-relaxed`) is the approved "code-things stay dark in
//     both themes" treatment — DESIGN.md tokens, canonical mockup
//     docs/designs/review-page.html. `dark:bg-white/[.03]` is the dark-theme
//     panel fill from that same token table.
//
// Wired as the `pre` override in BOTH pipelines (render-markdown's jsx-runtime
// components map and IMPORTED_MDX_COMPONENTS) so markdown and MDX render code
// blocks identically. Diagram fences never reach here — lib/remark-diagrams
// rewrites them to <kroki-diagram>/<KrokiDiagram> upstream, so KrokiDiagram
// rendering is untouched. Server component, no client JS, no webfonts.

export function CodeBlock({ children }: { children?: ReactNode }) {
  return (
    <pre className="not-prose my-6 overflow-x-auto rounded-2xl bg-zinc-900 p-4 font-mono text-xs leading-relaxed text-zinc-300 ring-1 ring-inset ring-white/10 shadow-md dark:bg-white/[.03]">
      {children}
    </pre>
  );
}
