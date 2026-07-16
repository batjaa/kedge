import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

const FIXTURES = join(import.meta.dirname, 'fixtures', 'projection');

const inputs = readdirSync(FIXTURES)
  .filter((name) => /\.(md|mdx)$/.test(name))
  .sort();

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type TextNode = DefaultTreeAdapterMap['textNode'];
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

function isText(node: Node): node is TextNode {
  return node.nodeName === '#text';
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

function renderedProjectionText(node: Node, projection: string): string {
  if (isText(node)) return node.value;
  if (!isElement(node)) return children(node).map((child) => renderedProjectionText(child, projection)).join('');

  const annotatedRange = range(node);
  if (attr(node, PROJECTION_ATOMIC_ATTR) === 'true' && annotatedRange) {
    return projection.slice(annotatedRange[0], annotatedRange[1]);
  }
  if (node.tagName === 'br') return '\n';
  const parts: string[] = [];
  let previousWasBreak = false;
  for (const child of children(node)) {
    let text = renderedProjectionText(child, projection);
    if (previousWasBreak && isText(child) && text.startsWith('\n')) {
      text = text.slice(1);
    }
    parts.push(text);
    previousWasBreak = isElement(child) && child.tagName === 'br';
  }
  const text = parts.join('');
  return node.tagName === 'pre' || node.tagName === 'code' ? text.replace(/\n$/, '') : text;
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
  for (const file of inputs) {
    it(`round-trips markdown annotations for ${file}`, async () => {
      fakeDiagramApi();
      const source = readFileSync(join(FIXTURES, file), 'utf8');
      const result = project(source);
      const markup = renderToStaticMarkup((await renderMarkdown(source)) as ReactElement);

      assertAnnotationsRoundTrip(markup, result);
    });

    it(`round-trips hardened MDX annotations for ${file}`, async () => {
      fakeDiagramApi();
      const source = readFileSync(join(FIXTURES, file), 'utf8');
      const result = await projectMdx(source);
      const { node, ok } = await renderMdx(source);

      expect(ok).toBe(true);
      assertAnnotationsRoundTrip(renderToStaticMarkup(node), result);
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
