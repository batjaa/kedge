import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from '../lib/render-markdown';
import { captureAnchorFromRange } from '../lib/anchor-capture-dom';
import { projectMdx, renderMdx } from '../lib/mdx';
import {
  PROJECTION_ATOMIC_ATTR,
  PROJECTION_RANGE_ATTR,
  componentToken,
  project,
  type ProjectionResult,
} from '../lib/projection';
import { PROJECTION_FIXTURES_DIR } from './projection-fixtures';

type Parse5Node = DefaultTreeAdapterMap['node'];
type Parse5Element = DefaultTreeAdapterMap['element'];
type Parse5Parent = DefaultTreeAdapterMap['parentNode'];
type FixtureFormat = 'md' | 'mdx';

class TestDomNode {
  readonly attrs = new Map<string, string>();
  readonly childNodes: TestDomNode[] = [];
  parentNode: TestDomNode | null = null;

  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    readonly nodeValue: string | null = null,
    readonly tagName?: string,
  ) {}

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  get textValue(): string {
    return this.nodeValue ?? this.childNodes.map((child) => child.textValue).join('');
  }
}

interface RenderedFixture {
  root: TestDomNode;
  plainText: string;
  projectionVersion: number;
}

function fakeDiagramApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ url: '/storage/diagrams/mermaid/annotation.svg' }), {
        status: 200,
      }),
    ),
  );
}

function isElement(node: Parse5Node): node is Parse5Element {
  return 'tagName' in node;
}

function children(node: Parse5Node): Parse5Node[] {
  return 'childNodes' in node ? ((node as Parse5Parent).childNodes as Parse5Node[]) : [];
}

function parseRenderedMarkup(markup: string): TestDomNode {
  const fragment = parseFragment(markup) as Parse5Node;
  return toTestDom(fragment);
}

function toTestDom(node: Parse5Node): TestDomNode {
  const dom = isElement(node)
    ? new TestDomNode(1, node.nodeName, null, node.tagName)
    : node.nodeName === '#text'
      ? new TestDomNode(3, '#text', (node as { value?: string }).value ?? '')
      : new TestDomNode(11, node.nodeName);

  if (isElement(node)) {
    for (const attr of node.attrs) dom.attrs.set(attr.name, attr.value);
  }

  for (const child of children(node)) {
    const childDom = toTestDom(child);
    childDom.parentNode = dom;
    dom.childNodes.push(childDom);
  }

  return dom;
}

async function renderSource(source: string, format: FixtureFormat): Promise<RenderedFixture> {
  fakeDiagramApi();
  const result: ProjectionResult = format === 'mdx' ? await projectMdx(source) : project(source);
  const markup =
    format === 'mdx'
      ? renderToStaticMarkup((await renderMdxOk(source)) as ReactElement)
      : renderToStaticMarkup((await renderMarkdown(source)) as ReactElement);

  return {
    root: parseRenderedMarkup(markup),
    plainText: result.plainText,
    projectionVersion: result.projectionVersion,
  };
}

async function renderMdxOk(source: string) {
  const { node, ok } = await renderMdx(source);
  expect(ok).toBe(true);
  return node;
}

async function renderFixture(file: string, format: FixtureFormat): Promise<RenderedFixture> {
  const source = readFileSync(join(PROJECTION_FIXTURES_DIR, file), 'utf8');
  return renderSource(source, format);
}

function makeRange(
  startContainer: TestDomNode,
  startOffset: number,
  endContainer: TestDomNode,
  endOffset: number,
): Range {
  return {
    collapsed: startContainer === endContainer && startOffset === endOffset,
    startContainer: startContainer as unknown as Node,
    startOffset,
    endContainer: endContainer as unknown as Node,
    endOffset,
  } as Range;
}

function capture(rendered: RenderedFixture, range: Range) {
  return captureAnchorFromRange({
    root: rendered.root as unknown as Node,
    plainText: rendered.plainText,
    projectionVersion: rendered.projectionVersion,
    range,
  });
}

function elements(root: TestDomNode, tagName: string): TestDomNode[] {
  const out: TestDomNode[] = [];
  walk(root, (node) => {
    if (node.tagName === tagName) out.push(node);
  });
  return out;
}

function elementsWithAttr(root: TestDomNode, name: string, value?: string): TestDomNode[] {
  const out: TestDomNode[] = [];
  walk(root, (node) => {
    const attr = node.getAttribute(name);
    if (attr != null && (value === undefined || attr === value)) out.push(node);
  });
  return out;
}

function textNodeContaining(root: TestDomNode, value: string): TestDomNode {
  let found: TestDomNode | null = null;
  walk(root, (node) => {
    if (!found && node.nodeType === 3 && (node.nodeValue ?? '').includes(value)) found = node;
  });
  expect(found, `missing text node containing ${value}`).toBeTruthy();
  return found!;
}

function childIndex(node: TestDomNode): number {
  expect(node.parentNode).toBeTruthy();
  return node.parentNode!.childNodes.indexOf(node);
}

function walk(node: TestDomNode, visit: (node: TestDomNode) => void): void {
  visit(node);
  for (const child of node.childNodes) walk(child, visit);
}

function okSelector(result: ReturnType<typeof capture>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.detail);
  return result.selector;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('browser anchor capture adapter', () => {
  it('resolves empty table cell endpoints through unannotated element ancestors', async () => {
    const rendered = await renderFixture('empty-table-cells.md', 'md');
    const cells = elements(rendered.root, 'td');
    expect(cells.length).toBeGreaterThanOrEqual(9);

    const firstRowMiddleCell = cells[1];
    const firstRowRightText = textNodeContaining(cells[2], 'c');
    const fromMiddleCell = okSelector(
      capture(rendered, makeRange(firstRowMiddleCell, 0, firstRowRightText, 1)),
    );
    expect(fromMiddleCell).toMatchObject({ exact: ' c', start: 38, end: 40 });

    const emptyRowMiddleCell = cells[4];
    const thirdRowFirstText = textNodeContaining(cells[6], 'x');
    const fromFullyEmptyRow = okSelector(
      capture(rendered, makeRange(emptyRowMiddleCell, 0, thirdRowFirstText, 1)),
    );
    expect(fromFullyEmptyRow).toMatchObject({ exact: '\nx', start: 40, end: 42 });
  });

  it('captures code fence text from the rendered markdown pipeline', async () => {
    const rendered = await renderFixture('code-fences.md', 'md');
    const codeText = textNodeContaining(rendered.root, 'return source.trim();');
    const start = codeText.textValue.indexOf('return');
    const exact = 'return source.trim()';

    const selector = okSelector(
      capture(rendered, makeRange(codeText, start, codeText, start + exact.length)),
    );

    expect(selector.exact).toBe(exact);
    expect(rendered.plainText.slice(selector.start, selector.end)).toBe(exact);
  });

  it('maps atomic container edge endpoints the same as parent boundary endpoints', async () => {
    const rendered = await renderFixture('components.mdx', 'mdx');
    const atomic = elementsWithAttr(rendered.root, PROJECTION_ATOMIC_ATTR, 'true')[0];
    expect(atomic.childNodes.length).toBeGreaterThan(0);
    expect(atomic.getAttribute(PROJECTION_RANGE_ATTR)).toBeTruthy();

    const beforeText = textNodeContaining(rendered.root, 'Before the component.');
    const afterText = textNodeContaining(rendered.root, 'After the component.');
    const parent = atomic.parentNode!;
    const index = childIndex(atomic);

    const nearAtomic = okSelector(capture(rendered, makeRange(beforeText, 0, atomic, 0)));
    const nearParent = okSelector(capture(rendered, makeRange(beforeText, 0, parent, index)));
    expect(nearAtomic).toMatchObject(pickComparable(nearParent));

    const farAtomic = okSelector(
      capture(rendered, makeRange(atomic, atomic.childNodes.length, afterText, afterText.textValue.length)),
    );
    const farParent = okSelector(
      capture(rendered, makeRange(parent, index + 1, afterText, afterText.textValue.length)),
    );
    expect(farAtomic).toMatchObject(pickComparable(farParent));
    expect(farAtomic.exact).toContain('After the component.');
    expect(farAtomic.exact).not.toContain(componentToken('Note'));
  });

  it('rejects trailing and whole atomic selections without truncating to the near edge', async () => {
    const trailing = await renderSource('# Trail\n\nText before.\n\n<Note>tail</Note>', 'mdx');
    const trailingAtomic = elementsWithAttr(trailing.root, PROJECTION_ATOMIC_ATTR, 'true')[0];
    const textBefore = textNodeContaining(trailing.root, 'Text before.');

    expect(
      capture(
        trailing,
        makeRange(textBefore, 0, trailingAtomic, trailingAtomic.childNodes.length),
      ),
    ).toMatchObject({
      ok: false,
      reason: 'selection_crosses_atomic',
    });

    const whole = await renderFixture('components.mdx', 'mdx');
    const wholeAtomic = elementsWithAttr(whole.root, PROJECTION_ATOMIC_ATTR, 'true')[0];
    expect(
      capture(whole, makeRange(wholeAtomic, 0, wholeAtomic, wholeAtomic.childNodes.length)),
    ).toMatchObject({
      ok: false,
      reason: 'whole_atomic_selection',
    });
  });

  it('fails closed when an atomic annotation has a malformed range', async () => {
    const rendered = await renderFixture('components.mdx', 'mdx');
    const atomic = elementsWithAttr(rendered.root, PROJECTION_ATOMIC_ATTR, 'true')[0];
    atomic.setAttribute(PROJECTION_RANGE_ATTR, 'not-a-range');

    const beforeText = textNodeContaining(rendered.root, 'Before the component.');
    expect(capture(rendered, makeRange(beforeText, 0, beforeText, 6))).toMatchObject({
      ok: false,
      reason: 'malformed_annotation',
    });
  });
});

function pickComparable(selector: { exact: string; start: number; end: number }) {
  return {
    exact: selector.exact,
    start: selector.start,
    end: selector.end,
  };
}
