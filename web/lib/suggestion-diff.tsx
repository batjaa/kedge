import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

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
    <div className="mt-2 overflow-hidden rounded-xl bg-zinc-900 font-mono text-xs ring-1 ring-white/10">
      <DiffLine marker="-" tokens={diff.before} kind="before" />
      <DiffLine marker="+" tokens={diff.after} kind="after" />
    </div>
  );
}

function DiffLine({
  marker,
  tokens,
  kind,
}: {
  marker: string;
  tokens: DiffToken[];
  kind: 'before' | 'after';
}) {
  // The empty-side placeholder is chrome (threads catalog); the diff tokens
  // themselves are the user's before/after text and render verbatim (#126).
  const t = useTranslations('threads');

  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] border-t border-zinc-700/50 first:border-t-0">
      <span className="select-none px-3 py-1.5 text-zinc-600">{marker}</span>
      <p className={kind === 'before'
        ? 'min-w-0 whitespace-pre-wrap break-words px-3 py-1.5 text-rose-400/90'
        : 'min-w-0 whitespace-pre-wrap break-words px-3 py-1.5 text-emerald-400'}
      >
        {tokens.length > 0 ? renderTokens(tokens) : <span className="text-zinc-400">{t('suggestionDiff.empty')}</span>}
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
      ? 'rounded bg-emerald-400/15 px-0.5 text-emerald-300'
      : 'rounded bg-rose-400/15 px-0.5 text-rose-300 line-through decoration-rose-400/70';

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
