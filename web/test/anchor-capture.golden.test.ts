import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  captureAnchorSelector,
  type AnchorCaptureNode,
  type AnchorCaptureResult,
} from '../lib/anchor-capture-core';
import { anchorCaptureFixtures } from './anchor-capture-fixtures';

// Golden anchor-capture corpus (SPEC §8.2 / M2). Each fixture is:
//
//   attrs-encoded rendered Projection structure + selection endpoints
//       -> captured Anchor selector or typed capture failure
//
// Regenerate intentionally with:
//
//     npm run test:update -- anchor-capture.golden.test.ts
//
// These goldens pin the pure core's contract before #61 wires browser capture
// into the composer.
const inputs = anchorCaptureFixtures();

interface FixtureEndpoint {
  path: number[];
  offset: number;
}

interface FixtureFile {
  projectionVersion: number;
  plainText: string;
  root: AnchorCaptureNode;
  selection: {
    start: FixtureEndpoint;
    end: FixtureEndpoint;
  };
}

describe('anchor capture golden corpus', () => {
  it('has fixtures to check', () => {
    expect(inputs.length).toBeGreaterThan(0);
  });

  for (const fixture of inputs) {
    it(`captures ${fixture.file} to its golden result`, async () => {
      const input = JSON.parse(readFileSync(fixture.sourcePath, 'utf8')) as FixtureFile;
      const result = captureAnchorSelector({
        root: input.root,
        plainText: input.plainText,
        projectionVersion: input.projectionVersion,
        start: {
          node: nodeAtPath(input.root, input.selection.start.path),
          offset: input.selection.start.offset,
        },
        end: {
          node: nodeAtPath(input.root, input.selection.end.path),
          offset: input.selection.end.offset,
        },
      });

      await expect(stableJson(result)).toMatchFileSnapshot(fixture.goldenPath);
    });
  }
});

function nodeAtPath(root: AnchorCaptureNode, path: number[]): AnchorCaptureNode {
  let node = root;
  for (const index of path) {
    const child = node.childNodes?.[index];
    expect(child, `fixture path ${path.join('.')} is invalid`).toBeTruthy();
    node = child!;
  }
  return node;
}

function stableJson(result: AnchorCaptureResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
