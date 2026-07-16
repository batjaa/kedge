import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { project } from '../lib/projection';
import { projectMdx } from '../lib/mdx';
import { projectionFixtures } from './projection-fixtures';

// Golden projection conformance corpus (SPEC §5.4 / §18.2). Each fixture document
// projects to a checked-in `.txt` golden. A pipeline change that alters any
// projection fails CI here until the goldens are regenerated *intentionally*:
//
//     npm run test:update            # rewrites the goldens from current output
//
// Regenerating is a deliberate act: it must accompany a projection_version bump
// (lib/projection.ts) whenever the algorithm's output changed, because every
// stored anchor offset is interpreted against a specific projection_version.
const inputs = projectionFixtures();

describe('projection golden corpus', () => {
  it('has fixtures to check', () => {
    expect(inputs.length).toBeGreaterThan(0);
  });

  for (const fixture of inputs) {
    it(`projects ${fixture.file} to its golden plain_text`, async () => {
      const source = readFileSync(fixture.sourcePath, 'utf8');
      const { plainText } =
        fixture.format === 'mdx' ? await projectMdx(source) : project(source);
      await expect(plainText).toMatchFileSnapshot(fixture.plainTextGoldenPath);
    });
  }
});
