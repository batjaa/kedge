import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from '../lib/render-markdown';
import { projectMdx, renderMdx } from '../lib/mdx';
import {
  PROJECTION_ATOMIC_ATTR,
  PROJECTION_RANGE_ATTR,
  componentToken,
  diagramToken,
  project,
  type ProjectionResult,
} from '../lib/projection';
import { renderedProjectionText } from '../lib/rendered-projection-text';
import { projectionFixtures } from './projection-fixtures';

// Render-time projection annotation corpus. The `.annotations.txt` goldens pin
// emitted ranges in DOM order:
//
//     npm run test:update            # rewrites plain_text and annotation dumps
//
// A range change without an intentional golden update means capture would bind
// comments to different DOM nodes even if the round-trip invariant still passed.
const inputs = projectionFixtures();

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];

function fakeDiagramApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ url: '/storage/diagrams/mermaid/annotation.svg' }), {
        status: 200,
      }),
    ),
  );
}

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function children(node: Node): Node[] {
  return 'childNodes' in node ? ((node as ParentNode).childNodes as Node[]) : [];
}

function attr(node: Element, name: string): string | undefined {
  return node.attrs.find((entry) => entry.name === name)?.value;
}

function range(node: Element): [number, number] | null {
  const raw = attr(node, PROJECTION_RANGE_ATTR);
  if (!raw) return null;
  const match = /^(\d+):(\d+)$/.exec(raw);
  expect(match, `invalid ${PROJECTION_RANGE_ATTR}: ${raw}`).not.toBeNull();
  return [Number(match![1]), Number(match![2])];
}

function collectAnnotated(node: Node, out: Element[] = []): Element[] {
  if (isElement(node) && attr(node, PROJECTION_RANGE_ATTR)) out.push(node);
  for (const child of children(node)) collectAnnotated(child, out);
  return out;
}

function annotationDump(markup: string): string {
  const fragment = parseFragment(markup) as Node;
  return collectAnnotated(fragment)
    .map((node) => {
      const [start, end] = range(node)!;
      const atomic = attr(node, PROJECTION_ATOMIC_ATTR) === 'true';
      return `${start}:${end}:${atomic}`;
    })
    .join('\n');
}

function assertAnnotationsRoundTrip(markup: string, result: ProjectionResult) {
  const fragment = parseFragment(markup) as Node;
  const annotated = collectAnnotated(fragment);
  expect(annotated.length).toBeGreaterThan(0);

  const computed = new Set(
    result.annotations.map((item) => `${item.start}:${item.end}:${item.atomic ? 'a' : 't'}`),
  );

  for (const node of annotated) {
    const parsed = range(node);
    expect(parsed).not.toBeNull();
    const [start, end] = parsed!;
    const atomic = attr(node, PROJECTION_ATOMIC_ATTR) === 'true';

    expect(computed.has(`${start}:${end}:${atomic ? 'a' : 't'}`)).toBe(true);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(end).toBeLessThanOrEqual(result.plainText.length);

    const expected = result.plainText.slice(start, end);
    expect(renderedProjectionText(node, result.plainText)).toBe(expected);
    if (atomic) expect(expected).toMatch(/^⟦.+⟧$/);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('render-time projection annotations', () => {
  for (const fixture of inputs) {
    it(`pins and round-trips annotations for ${fixture.file}`, async () => {
      fakeDiagramApi();
      const source = readFileSync(fixture.sourcePath, 'utf8');
      const result =
        fixture.format === 'mdx' ? await projectMdx(source) : project(source);
      let markup: string;
      if (fixture.format === 'mdx') {
        const { node, ok } = await renderMdx(source);
        expect(ok).toBe(true);
        markup = renderToStaticMarkup(node);
      } else {
        markup = renderToStaticMarkup((await renderMarkdown(source)) as ReactElement);
      }

      await expect(annotationDump(markup)).toMatchFileSnapshot(fixture.annotationsGoldenPath);
      assertAnnotationsRoundTrip(markup, result);
    });
  }

  it('marks allowlisted, unsupported, and diagram MDX components as atomic placeholders', async () => {
    fakeDiagramApi();
    const source = [
      '<Note title="Anchoring">visible child text</Note>',
      '',
      '<ExperimentalWidget>discarded child text</ExperimentalWidget>',
      '',
      '```mermaid',
      'graph TD',
      'A-->B',
      '```',
    ].join('\n');

    const result = await projectMdx(source);
    expect(result.plainText).toBe(
      [componentToken('Note'), componentToken('ExperimentalWidget'), diagramToken('mermaid')].join(
        '\n\n',
      ),
    );

    const { node, ok } = await renderMdx(source);
    expect(ok).toBe(true);
    const markup = renderToStaticMarkup(node);
    assertAnnotationsRoundTrip(markup, result);

    const fragment = parseFragment(markup) as Node;
    const atomic = collectAnnotated(fragment)
      .filter((node) => attr(node, PROJECTION_ATOMIC_ATTR) === 'true')
      .map((node) => {
        const [start, end] = range(node)!;
        return result.plainText.slice(start, end);
      });

    expect(atomic).toEqual([
      componentToken('Note'),
      componentToken('ExperimentalWidget'),
      diagramToken('mermaid'),
    ]);
  });
});
