import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reanchorExact, type ReanchorInputAnchor, type ReanchorResult } from '../lib/reanchor-core';
import { reanchorFixtures } from './reanchor-fixtures';

// Golden exact re-anchor corpus (SPEC §8.3 / M3 #76). Each fixture is:
//
//   anchors captured on version A + plain_text of version B
//       -> exact-tier anchored/orphaned results
//
// Regenerate intentionally with:
//
//     npm run test:update -- reanchor.golden.test.ts
const inputs = reanchorFixtures();

interface FixtureFile {
  newPlainText: string;
  anchors: ReanchorInputAnchor[];
}

describe('exact reanchor golden corpus', () => {
  it('has fixtures to check', () => {
    expect(inputs.length).toBeGreaterThan(0);
  });

  for (const fixture of inputs) {
    it(`reanchors ${fixture.file} to its golden result`, async () => {
      const input = JSON.parse(readFileSync(fixture.sourcePath, 'utf8')) as FixtureFile;
      const results = reanchorExact(input.anchors, input.newPlainText);

      await expect(stableJson(results)).toMatchFileSnapshot(fixture.goldenPath);
    });
  }
});

function stableJson(results: ReanchorResult[]): string {
  return `${JSON.stringify({ results }, null, 2)}\n`;
}
