// The standard "nothing to render here" panel (DESIGN.md panel anatomy): a
// centered title + body inside the `rounded-2xl` hairline card. Used for the
// unreachable-API degraded state on the document page and the home list, so
// both speak the same idiom when a read fails.
export function StatePanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-8 rounded-2xl bg-white p-8 text-center ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
        {title}
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {body}
      </p>
    </div>
  );
}
