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
      // Safety net: any other unknown fence language renders as plain text,
      // never crashes the page.
      langAlias: { plantuml: 'txt' },
    },
  },
});
