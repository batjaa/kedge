import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The mn-MN display-font override (eng-review 12A). Space Grotesk has no Cyrillic,
// so Mongolian must resolve the display token to the system stack WHOLESALE — one
// locale-conditional override, never per-glyph fallback. This asserts the single
// rule that makes it so; `html lang` is driven by the negotiated locale in
// app/layout.tsx (proven end-to-end by the i18n e2e journey).
describe('mn-MN display-font resolution', () => {
  const css = fs.readFileSync(
    path.join(process.cwd(), 'app', 'global.css'),
    'utf8',
  );

  it("overrides --font-display to the system sans stack under html[lang='mn-MN']", () => {
    // Isolate the mn-MN rule block and assert its declaration, tolerant of
    // whitespace but not of the rule being absent or pointing elsewhere.
    const block = /html\[lang=['"]mn-MN['"]\]\s*\{([^}]*)\}/.exec(css);
    expect(block, 'no html[lang="mn-MN"] rule in global.css').not.toBeNull();
    const body = block![1].replace(/\s+/g, ' ');
    expect(body).toContain('--font-display: var(--font-sans)');
  });

  it('leaves the default display token as Space Grotesk (no global regression)', () => {
    expect(css).toMatch(/--font-display:\s*'Space Grotesk'/);
  });
});
