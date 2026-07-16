import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderCommentMarkdown } from '@/lib/render-comment-markdown';

function html(markdown: string): string {
  return renderToStaticMarkup(renderCommentMarkdown(markdown));
}

describe('renderCommentMarkdown', () => {
  test('drops raw html tags without turning them into executable elements', () => {
    const rendered = html('Hello <script>alert(1)</script><img src=x onerror=alert(2)> world');

    expect(rendered).toContain('Hello');
    expect(rendered).toContain('world');
    expect(rendered).not.toContain('<script');
    expect(rendered).not.toContain('<img');
    expect(rendered).not.toContain('onerror');
  });

  test('does not truncate prose after an unclosed script mention', () => {
    const rendered = html('check the <script> loader, thanks!');

    expect(rendered).toContain('check the');
    expect(rendered).toContain('loader, thanks!');
    expect(rendered).not.toContain('<script');
  });

  test('sanitizes unsafe links', () => {
    const rendered = html('[bad](javascript:alert(1)) [good](https://example.test)');

    expect(rendered).not.toContain('javascript:');
    expect(rendered).toContain('href="https://example.test"');
  });

  test('keeps diagram fences as plain code', () => {
    const rendered = html('```mermaid\ngraph TD\n```');

    expect(rendered).toContain('<pre');
    expect(rendered).toContain('graph TD');
    expect(rendered).not.toContain('kroki');
  });

  test('does not render mdx components', () => {
    const rendered = html('<KrokiDiagram engine="mermaid" source="graph TD" />\n\nText');

    expect(rendered).toContain('Text');
    expect(rendered).not.toContain('KrokiDiagram');
    expect(rendered).not.toContain('graph TD');
  });

  test('renders mention tokens as inert styled text', () => {
    const rendered = html('Please ask [@Alice Reviewer](mention:42).');

    expect(rendered).toContain('data-mention-id="42"');
    expect(rendered).toContain('@Alice Reviewer');
    expect(rendered).not.toContain('href="mention:42"');
  });

  test('does not turn crafted mention labels into markup', () => {
    const rendered = html('Hi [@<img src=x onerror=alert(1)>](mention:7)');

    expect(rendered).toContain('data-mention-id="7"');
    expect(rendered).not.toContain('<img');
    expect(rendered).not.toContain('onerror');
  });
});
