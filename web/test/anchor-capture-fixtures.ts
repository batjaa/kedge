import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const ANCHOR_CAPTURE_FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'anchor-capture');
export const ANCHOR_CAPTURE_GOLDEN_DIR = join(ANCHOR_CAPTURE_FIXTURES_DIR, '__golden__');

export interface AnchorCaptureFixture {
  file: string;
  sourcePath: string;
  goldenPath: string;
}

export function anchorCaptureFixtures(): AnchorCaptureFixture[] {
  return readdirSync(ANCHOR_CAPTURE_FIXTURES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      sourcePath: join(ANCHOR_CAPTURE_FIXTURES_DIR, file),
      goldenPath: join(ANCHOR_CAPTURE_GOLDEN_DIR, `${file}.golden.json`),
    }));
}
