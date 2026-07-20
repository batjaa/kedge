import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const REANCHOR_FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'reanchor');
export const REANCHOR_GOLDEN_DIR = join(REANCHOR_FIXTURES_DIR, '__golden__');

export interface ReanchorFixture {
  file: string;
  sourcePath: string;
  goldenPath: string;
}

export function reanchorFixtures(): ReanchorFixture[] {
  return readdirSync(REANCHOR_FIXTURES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      sourcePath: join(REANCHOR_FIXTURES_DIR, file),
      goldenPath: join(REANCHOR_GOLDEN_DIR, `${file}.golden.json`),
    }));
}
