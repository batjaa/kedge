import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { remarkDiagrams } from './lib/remark-diagrams';

// You can customize Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    // Converts mermaid/plantuml fences into live diagram components (SPEC §6.2)
    remarkPlugins: [remarkDiagrams],
    rehypeCodeOptions: {
      themes: { light: 'github-light', dark: 'github-dark' },
      // Unknown fence languages fall through to plain-text highlighting rather
      // than crashing Shiki (SPEC §6.2, hard rule #2). This is the real fallback
      // that replaces the spike's `langAlias: { plantuml: 'txt' }` workaround:
      // a single rule that covers every unknown language, not one special case.
      // (Diagram fences never reach Shiki — remarkDiagrams converts them to
      // <KrokiDiagram> first.)
      fallbackLanguage: 'plaintext',
    },
  },
});
