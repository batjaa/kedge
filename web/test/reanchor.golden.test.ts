import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reanchorAnchors, type ReanchorInputAnchor, type ReanchorOptions, type ReanchorResult } from '../lib/reanchor-core';
import { reanchorFixtures } from './reanchor-fixtures';

// Golden re-anchor corpus (SPEC §8.3 / M3). Each fixture is:
//
//   anchors captured on version A + plain_text of version B
//       -> exact/fuzzy anchored/relocated/orphaned results
//
// Regenerate intentionally with:
//
//     npm run test:update -- reanchor.golden.test.ts
const inputs = reanchorFixtures();

interface FixtureFile {
  newPlainText: string;
  anchors: ReanchorInputAnchor[];
  options?: Pick<ReanchorOptions, 'fuzzyTimeoutMs'>;
}

describe('reanchor golden corpus', () => {
  it('has fixtures to check', () => {
    expect(inputs.length).toBeGreaterThan(0);
  });

  for (const fixture of inputs) {
    it(`reanchors ${fixture.file} to its golden result`, async () => {
      const input = JSON.parse(readFileSync(fixture.sourcePath, 'utf8')) as FixtureFile;
      const results = reanchorAnchors(input.anchors, input.newPlainText, input.options ?? {});

      await expect(stableJson(results)).toMatchFileSnapshot(fixture.goldenPath);
    });
  }
});

function stableJson(results: ReanchorResult[]): string {
  return `${JSON.stringify({ results }, null, 2)}\n`;
}
