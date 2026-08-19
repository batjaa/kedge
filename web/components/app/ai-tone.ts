/**
 * The agent register: the ONE place the colour of an AI control is decided
 * (DESIGN.md — status hues, amended 2026-08-19 for #143).
 *
 * The line these tones draw is deliberate and narrow: **a control wears violet
 * when clicking it leads to a model run** — either it starts one (Generate,
 * Ask, Summarize, a stance pill) or it opens the surface whose only purpose is
 * to start one (the header triggers, the split affordance). Everything else
 * keeps the human register: a write the person makes under their own name
 * (post, reply, approve a split proposal, approve the document) stays
 * `zinc-900` in light / `emerald` in dark, and a neutral utility that touches
 * no model at all (Copy) stays zinc in both themes.
 *
 * Before this existed the register was dark-mode-only: in light mode an AI CTA
 * fell back to `bg-zinc-900`, byte-identical to a human primary, so a Sparkles
 * icon was the only thing separating "this invokes a model" from "this posts as
 * you" (#143). These fragments are COLOUR ONLY — geometry (radius, padding,
 * type scale) stays with each control, because the controls are genuinely
 * different sizes and pretending otherwise would flatten a hierarchy the panels
 * rely on.
 *
 * Each tone defines its hover in BOTH themes, so a control can never drift into
 * having a hover in one theme and none in the other. Focus stays emerald
 * everywhere per DESIGN.md's interaction rules — focus is a system affordance,
 * not a statement about who acts.
 *
 * Disabled stays each control's own `disabled:opacity-*`, unchanged. A tint at
 * 60% is fainter than a `zinc-900` fill at 60% was, which is the point — WCAG
 * exempts inactive controls from contrast, and dark mode has looked exactly
 * this way since M4. The two themes now agree instead of one of them being
 * louder about a button you cannot press.
 */

/** Tinted fill: the resting state of an AI control that starts or opens a run. */
export const AI_TONE_CLASS =
  'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/20 hover:bg-violet-100 hover:text-violet-800 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/20 dark:hover:bg-violet-400/15 dark:hover:text-violet-200';

/**
 * Ring-only: an AI control in a pick-one group, where the FILL is what says
 * "selected" and so cannot also be what says "agent" (the reply-draft stance
 * pills).
 */
export const AI_TONE_QUIET_CLASS =
  'bg-white text-violet-700 ring-1 ring-inset ring-violet-600/20 hover:bg-violet-50 hover:text-violet-800 dark:bg-white/5 dark:text-violet-300 dark:ring-violet-400/20 dark:hover:bg-white/10 dark:hover:text-violet-200';

/**
 * The icon-button variant, for an AI affordance that sits in a row of human
 * icon buttons (the comment-split trigger, one gap away from Fork). No resting
 * fill, because its neutral siblings have none and a filled square in that row
 * would read as "selected" rather than "agent".
 */
export const AI_ICON_TONE_CLASS =
  'text-violet-600 ring-1 ring-inset ring-violet-600/20 hover:bg-violet-50 hover:text-violet-700 dark:text-violet-300 dark:ring-violet-400/20 dark:hover:bg-violet-400/10 dark:hover:text-violet-200';
