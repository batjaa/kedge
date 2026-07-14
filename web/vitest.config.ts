import { defineConfig } from 'vitest/config';

// The web rendering-pipeline test seam (SPEC §18, testing decision 2). Runs the
// projection functions directly against a fixture corpus — no browser, no Next
// server. Deliberately scoped to *.test.ts under test/ and lib/ so it never
// collides with Playwright's *.spec.ts under e2e/ (which vitest's default `spec`
// glob would otherwise sweep up).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'lib/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**', '.source/**'],
    environment: 'node',
  },
});
