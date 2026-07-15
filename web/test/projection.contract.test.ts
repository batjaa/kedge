import { describe, it, expect } from 'vitest';
import {
  project,
  PROJECTION_VERSION,
  imageToken,
  diagramToken,
} from '../lib/projection';

// Explicit assertions on the projection contract — the invariants the golden
// snapshots depend on but don't state in prose. These lock intent: what a
// placeholder is, that offsets survive around one, that frontmatter never leaks
// into the anchor substrate.
describe('projection contract (SPEC §5.4)', () => {
  it('starts at projection_version 1 and reports it', () => {
    expect(PROJECTION_VERSION).toBe(1);
    expect(project('# Hi').projectionVersion).toBe(1);
  });

  it('drops YAML frontmatter from the anchor substrate', () => {
    const { plainText } = project('---\ntitle: X\ntags: [a, b]\n---\n\n# Heading\n\nBody.');
    expect(plainText).toBe('Heading\n\nBody.');
  });

  it('collapses an image to a stable placeholder token', () => {
    const { plainText } = project('Before ![alt text](img.png) after.');
    expect(plainText).toBe(`Before ${imageToken()} after.`);
    expect(imageToken()).toBe('⟦image⟧');
  });

  it('collapses a diagram fence to an engine-tagged token but keeps prose code as text', () => {
    expect(project('```mermaid\ngraph TD\nA-->B\n```').plainText).toBe(diagramToken('mermaid'));
    expect(project('```ts\nconst x = 1;\n```').plainText).toBe('const x = 1;');
  });

  it('resolves diagram-language aliases through the one shared allowlist', () => {
    expect(project('```dot\ndigraph{}\n```').plainText).toBe(diagramToken('graphviz'));
    expect(project('```puml\n@startuml\n@enduml\n```').plainText).toBe(diagramToken('plantuml'));
  });

  it('leaves an unknown fence language as anchorable text, never a diagram', () => {
    expect(project('```wat\n(module)\n```').plainText).toBe('(module)');
  });

  it('keeps link text but not the URL', () => {
    expect(project('See [the spec](https://kedge.review/x) now.').plainText).toBe(
      'See the spec now.',
    );
  });

  it('keeps text offsets stable and atomic around a placeholder', () => {
    const token = imageToken();
    const { plainText } = project('A ![img](x) B');
    expect(plainText).toBe(`A ${token} B`);
    // "A " occupies offsets 0..1; the token is one atomic run; "B" follows it.
    expect(plainText.indexOf(token)).toBe(2);
    expect(plainText.indexOf('B')).toBe(2 + token.length + 1);
  });

  it('strips reserved delimiter characters from source text and warns', () => {
    const { plainText, warnings } = project('Prose with ⟦ and ⟧ literals.');
    expect(plainText).toBe('Prose with  and  literals.');
    expect(warnings).toHaveLength(1);
  });

  it('is deterministic — identical source projects byte-identically', () => {
    const src = '# Title\n\nBody with ![i](x.png) and `code`.\n\n```d2\na -> b\n```';
    expect(project(src).plainText).toBe(project(src).plainText);
  });

  it('reports mdx_ok true for markdown and always returns a warnings array', () => {
    const result = project('# ok\n\ntext');
    expect(result.mdxOk).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('never emits a heading marker or leading blank line', () => {
    const { plainText } = project('# Heading\n\nParagraph one.\n\nParagraph two.');
    expect(plainText).toBe('Heading\n\nParagraph one.\n\nParagraph two.');
  });
});
