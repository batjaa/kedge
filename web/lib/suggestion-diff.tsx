import type { ReactNode } from 'react';

export type DiffKind = 'equal' | 'added' | 'removed';

export interface DiffToken {
  kind: DiffKind;
  value: string;
}

export interface SuggestionDiffResult {
  before: DiffToken[];
  after: DiffToken[];
}

const MAX_FULL_DIFF_TOKENS = 1200;

export function diffSuggestionText(before: string, after: string): SuggestionDiffResult {
  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);

  if (beforeTokens.length + afterTokens.length > MAX_FULL_DIFF_TOKENS) {
    return coarseDiff(before, after);
  }

  const table = longestCommonSubsequenceTable(beforeTokens, afterTokens);
  const beforeDiff: DiffToken[] = [];
  const afterDiff: DiffToken[] = [];
  let i = 0;
  let j = 0;

  while (i < beforeTokens.length && j < afterTokens.length) {
    if (beforeTokens[i] === afterTokens[j]) {
      beforeDiff.push({ kind: 'equal', value: beforeTokens[i] });
      afterDiff.push({ kind: 'equal', value: afterTokens[j] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      beforeDiff.push({ kind: 'removed', value: beforeTokens[i] });
      i++;
    } else {
      afterDiff.push({ kind: 'added', value: afterTokens[j] });
      j++;
    }
  }

  while (i < beforeTokens.length) {
    beforeDiff.push({ kind: 'removed', value: beforeTokens[i] });
    i++;
  }

  while (j < afterTokens.length) {
    afterDiff.push({ kind: 'added', value: afterTokens[j] });
    j++;
  }

  return { before: beforeDiff, after: afterDiff };
}

export function SuggestionDiff({ diff }: { diff: SuggestionDiffResult }) {
  return (
    <div className="mt-2 space-y-2 rounded-md bg-zinc-50 p-2 ring-1 ring-inset ring-zinc-900/10 dark:bg-zinc-950 dark:ring-white/10">
      <DiffLine label="Before" tokens={diff.before} />
      <DiffLine label="After" tokens={diff.after} />
    </div>
  );
}

function DiffLine({ label, tokens }: { label: string; tokens: DiffToken[] }) {
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2 text-xs leading-5">
      <span className="font-mono text-[10px] uppercase text-zinc-500 dark:text-zinc-500">{label}</span>
      <p className="min-w-0 whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300">
        {tokens.length > 0 ? renderTokens(tokens) : <span className="text-zinc-400">empty</span>}
      </p>
    </div>
  );
}

function renderTokens(tokens: DiffToken[]): ReactNode[] {
  return tokens.map((token, index) => {
    if (token.kind === 'equal') {
      return <span key={index}>{token.value}</span>;
    }

    const classes = token.kind === 'added'
      ? 'rounded bg-emerald-100 px-0.5 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200'
      : 'rounded bg-rose-100 px-0.5 text-rose-800 line-through decoration-rose-500/70 dark:bg-rose-400/15 dark:text-rose-200';

    return (
      <span key={index} className={classes}>
        {token.value}
      </span>
    );
  });
}

function tokenize(value: string): string[] {
  return value.match(/\n+|[^\S\n]+|\S+/g) ?? [];
}

function coarseDiff(before: string, after: string): SuggestionDiffResult {
  if (before === after) {
    const equal = before === '' ? [] : [{ kind: 'equal' as const, value: before }];

    return { before: equal, after: equal };
  }

  return {
    before: before === '' ? [] : [{ kind: 'removed', value: before }],
    after: after === '' ? [] : [{ kind: 'added', value: after }],
  };
}

function longestCommonSubsequenceTable(before: string[], after: string[]): number[][] {
  const table = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0) as number[]);

  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] = before[i] === after[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  return table;
}
