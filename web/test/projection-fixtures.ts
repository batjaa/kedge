import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const PROJECTION_FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'projection');
export const PROJECTION_GOLDEN_DIR = join(PROJECTION_FIXTURES_DIR, '__golden__');

export interface ProjectionFixture {
  file: string;
  sourcePath: string;
  plainTextGoldenPath: string;
  annotationsGoldenPath: string;
  format: 'md' | 'mdx';
}

export function projectionFixtures(): ProjectionFixture[] {
  return readdirSync(PROJECTION_FIXTURES_DIR)
    .filter((name) => /\.(md|mdx)$/.test(name))
    .sort()
    .map((file) => ({
      file,
      sourcePath: join(PROJECTION_FIXTURES_DIR, file),
      plainTextGoldenPath: join(PROJECTION_GOLDEN_DIR, `${file}.txt`),
      annotationsGoldenPath: join(PROJECTION_GOLDEN_DIR, `${file}.annotations.txt`),
      format: file.endsWith('.mdx') ? 'mdx' : 'md',
    }));
}
