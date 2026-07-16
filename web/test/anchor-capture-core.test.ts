import { describe, expect, it } from 'vitest';
import {
  captureAnchorSelector,
  type AnchorCaptureNode,
} from '../lib/anchor-capture-core';

describe('anchor capture core edge cases', () => {
  it('walks unannotated childless elements through projected siblings', () => {
    const root: AnchorCaptureNode = {
      tagName: 'article',
      childNodes: [
        {
          tagName: 'p',
          attrs: [{ name: 'data-prange', value: '0:5' }],
          childNodes: [{ nodeName: '#text', value: 'Alpha' }],
        },
        { tagName: 'div', childNodes: [] },
        {
          tagName: 'p',
          attrs: [{ name: 'data-prange', value: '7:12' }],
          childNodes: [{ nodeName: '#text', value: 'Omega' }],
        },
      ],
    };

    const result = captureAnchorSelector({
      root,
      plainText: 'Alpha\n\nOmega',
      projectionVersion: 60,
      start: { node: root.childNodes![1], offset: 0 },
      end: { node: root.childNodes![2].childNodes![0], offset: 5 },
    });

    expect(result).toMatchObject({
      ok: true,
      selector: {
        exact: '\n\nOmega',
        start: 5,
        end: 12,
      },
    });
  });

  it('reports an out-of-bounds mapped start before testing selection direction', () => {
    const root: AnchorCaptureNode = {
      tagName: 'article',
      childNodes: [
        {
          tagName: 'p',
          attrs: [{ name: 'data-prange', value: '10:15' }],
          childNodes: [{ nodeName: '#text', value: 'Bad' }],
        },
        {
          tagName: 'p',
          attrs: [{ name: 'data-prange', value: '0:5' }],
          childNodes: [{ nodeName: '#text', value: 'Alpha' }],
        },
      ],
    };

    const result = captureAnchorSelector({
      root,
      plainText: 'Alpha',
      projectionVersion: 60,
      start: { node: root.childNodes![0].childNodes![0], offset: 0 },
      end: { node: root.childNodes![1].childNodes![0], offset: 5 },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'endpoint_outside_projection',
      detail: 'Selection start offset 10 is outside projection bounds 0:5.',
    });
  });

  it('fails closed when an atomic annotation is missing its range', () => {
    const root: AnchorCaptureNode = {
      tagName: 'article',
      childNodes: [
        {
          tagName: 'p',
          attrs: [{ name: 'data-prange', value: '0:12' }],
          childNodes: [
            { nodeName: '#text', value: 'Before ' },
            {
              tagName: 'span',
              attrs: [{ name: 'data-patomic', value: 'true' }],
              childNodes: [{ nodeName: '#text', value: 'widget' }],
            },
            { nodeName: '#text', value: 'after' },
          ],
        },
      ],
    };

    const result = captureAnchorSelector({
      root,
      plainText: 'Before after',
      projectionVersion: 60,
      start: { node: root.childNodes![0].childNodes![0], offset: 0 },
      end: { node: root.childNodes![0].childNodes![0], offset: 6 },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'malformed_annotation',
    });
  });
});
