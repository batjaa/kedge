import type { DigestEntry, DigestOutput } from './ai-types';

/**
 * Copy-as-markdown for the review digest (SPEC §14.1, user story 2): the
 * author's way to take the digest out of Kedge before post-back arrives in M6.
 *
 * Labels are passed in already translated, so this stays a pure serializer and
 * the copied artifact speaks the reader's language. The coverage statement is
 * carried through VERBATIM — an honest "covers 12 of 20 threads" must survive
 * the trip to wherever the author pastes it.
 */
export interface DigestMarkdownLabels {
  title: string;
  themes: string;
  contentionPoints: string;
  consensus: string;
  actionItems: string;
  empty: string;
}

export function digestToMarkdown(output: DigestOutput, labels: DigestMarkdownLabels): string {
  const sections: Array<[string, DigestEntry[]]> = [
    [labels.themes, output.themes],
    [labels.contentionPoints, output.contention_points],
    [labels.consensus, output.consensus],
    [labels.actionItems, output.action_items],
  ];

  const lines = [`# ${labels.title}`, '', `_${output.coverage.statement}_`];

  for (const [heading, entries] of sections) {
    lines.push('', `## ${heading}`, '');

    if (entries.length === 0) {
      lines.push(`_${labels.empty}_`);
      continue;
    }

    for (const entry of entries) {
      lines.push(`- **${entry.title}** — ${entry.summary}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
