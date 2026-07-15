import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { project } from '../lib/projection';

// Golden projection conformance corpus (SPEC §5.4 / §18.2). Each fixture document
// projects to a checked-in `.txt` golden. A pipeline change that alters any
// projection fails CI here until the goldens are regenerated *intentionally*:
//
//     npm run test:update            # rewrites the goldens from current output
//
// Regenerating is a deliberate act: it must accompany a projection_version bump
// (lib/projection.ts) whenever the algorithm's output changed, because every
// stored anchor offset is interpreted against a specific projection_version.
const FIXTURES = join(import.meta.dirname, 'fixtures', 'projection');

const inputs = readdirSync(FIXTURES)
  .filter((name) => /\.(md|mdx)$/.test(name))
  .sort();

describe('projection golden corpus', () => {
  it('has fixtures to check', () => {
    expect(inputs.length).toBeGreaterThan(0);
  });

  for (const file of inputs) {
    it(`projects ${file} to its golden plain_text`, async () => {
      const source = readFileSync(join(FIXTURES, file), 'utf8');
      const { plainText } = project(source);
      await expect(plainText).toMatchFileSnapshot(join(FIXTURES, '__golden__', `${file}.txt`));
    });
  }
});
