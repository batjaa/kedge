import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The web rendering-pipeline test seam (SPEC §18, testing decision 2). Runs the
// projection AND the hardened MDX pipeline (§18.3 adversarial suite) directly
// against a fixture corpus — no browser, no Next server. Deliberately scoped to
// *.test.ts(x) under test/ and lib/ so it never collides with Playwright's
// *.spec.ts under e2e/ (which vitest's default `spec` glob would sweep up).
export default defineConfig({
  // Mirror tsconfig's `@/*` → `./*` so tests import app modules the same way the
  // Next build does; the MDX components render through the real allowlist.
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  // The MDX components and lib/mdx render JSX via React's automatic runtime.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    include: ['test/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**', '.source/**'],
    environment: 'node',
  },
});
