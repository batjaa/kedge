// Shared Tailwind class fragments for the tracked-repo trio — the panel, the row
// list, and the preview (SPEC §16, M3.6, C7). The emerald action button, the rose
// error panel, and the outcome/overlap pill had drifting copies across the three;
// this gives each ONE home. Each component appends its own spacing/size, so
// intentional per-context differences (a compact row error vs a preview panel
// error, a submit vs a confirm button) stay local — no over-abstraction.

/** The emerald action button body — color, hover, focus, disabled, dark. Append layout (shrink/px/py). */
export const EMERALD_BUTTON =
  'rounded-full bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15';

/** The rose error panel body — surface, ring, text. Append spacing (mt/p) per context. */
export const ROSE_PANEL =
  'rounded-xl bg-rose-50 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20';

/** The outcome/overlap pill base — shape and type. Append color classes per
 *  variant. The 16ch clamp is the chip glossary's truncation safety (M3.9 13A):
 *  labels are catalog strings budgeted at 15 chars, so the clamp never bites in
 *  a well-formed locale — belt-and-braces only. */
export const PILL_BASE =
  'inline-block max-w-[16ch] shrink-0 truncate rounded-full px-2 py-0.5 text-xs font-medium';
