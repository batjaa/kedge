import type { ComponentType, ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { compile, run } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import type { MDXComponents } from 'mdx/types';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PluggableList } from 'unified';
import { remarkDiagrams } from './remark-diagrams';
import { remarkMdxHarden } from './remark-mdx-harden';
import {
  PROJECTION_FILE_DATA_KEY,
  type ProjectionResult,
  project,
  remarkProjectionAnnotations,
} from './projection';
import { IMPORTED_MDX_COMPONENTS } from '@/components/imported-mdx';
import { renderMarkdown } from './render-markdown';

// The hardened MDX pipeline for imported (untrusted) documents (SPEC §6.1).
// Server-only. `@mdx-js/mdx` compiles the source to JS with our security stack
// baked in — remark-diagrams (fences → KrokiDiagram) then remark-mdx-harden
// (reject import/export & non-literal expressions, allowlist components,
// sanitize raw HTML). The compiled artifact is cached by content hash so a
// version compiles once, not once per request.
//
// The SAME compile is the MDX validator: lib/projection walks the mdast for the
// anchor substrate, and this module attempts the full compile to decide mdx_ok.
// A rejection or a syntax error is not an exception the page must handle — it is
// simply mdx_ok=false, which routes the doc to the plain-markdown fallback.

type MdxContent = ComponentType<{ components?: MDXComponents }>;

// Plugin order matters: diagrams convert fences to <KrokiDiagram> (an allowlisted
// component) BEFORE the harden pass runs, so they survive; harden runs last so it
// is the final word on what compiles.
const BASE_REMARK_PLUGINS = [
  remarkFrontmatter,
  remarkGfm,
  remarkDiagrams,
  remarkMdxHarden,
] satisfies PluggableList;

function remarkPluginsForProjection(annotate: boolean): PluggableList {
  return [
    ...BASE_REMARK_PLUGINS,
    [remarkProjectionAnnotations, { annotate }],
  ] satisfies PluggableList;
}

/**
 * Compile untrusted MDX to a JS module body string. Throws MdxRejectedError (a
 * rejected construct) or a compile error (bad syntax) — both mean "not valid
 * MDX", handled by the callers as mdx_ok=false.
 */
async function compileToSource(content: string): Promise<string> {
  const file = await compile(content, {
    outputFormat: 'function-body',
    // No rehype-sanitize: it drops mdxJsx nodes wholesale (incl. our allowlisted
    // components). The tight schema is enforced in remark-mdx-harden instead.
    remarkPlugins: remarkPluginsForProjection(true),
  });
  return String(file);
}

async function runSource(source: string): Promise<MdxContent> {
  const mod = await run(source, {
    Fragment,
    jsx,
    jsxs,
    baseUrl: import.meta.url,
  } as Parameters<typeof run>[1]);
  return mod.default as MdxContent;
}

// ── Compile cache ────────────────────────────────────────────────────────────
// Two layers, justified by Next's process model:
//   L1 — in-process LRU keyed by content hash, holding the outcome PROMISE. The
//        Next server is a long-lived process, so this is shared across requests
//        (not a per-build cache) and dedupes concurrent compiles of the same
//        version. A compiled MDXContent is a live closure — it cannot be
//        serialized — so L1 is where "render per request without recompiling"
//        actually happens.
//   L2 — best-effort on-disk cache of the compiled JS SOURCE string (what
//        compile() produces, before run()). Survives cold starts and is shared
//        across worker processes on one host, so the expensive parse+transform
//        happens once per version per HOST, not once per process. Any disk error
//        falls through to a recompile; the disk never holds failures.
//
// The key is sha256(cache-version + content). The version salt invalidates old
// compiled JSX when render-only transforms change without changing document
// bytes.

type Outcome =
  | { ok: true; Content: MdxContent }
  | { ok: false; reason: string };

const L1_MAX = Number(process.env.MDX_CACHE_MAX ?? 128);
const l1 = new Map<string, Promise<Outcome>>();

const L2_DIR = process.env.MDX_CACHE_DIR ?? join(tmpdir(), 'kedge-mdx-cache');
const MDX_COMPILE_CACHE_VERSION = 'projection-annotations-v1';

function cacheKey(content: string): string {
  return createHash('sha256').update(MDX_COMPILE_CACHE_VERSION).update('\0').update(content).digest('hex');
}

function l1Get(key: string): Promise<Outcome> | undefined {
  const hit = l1.get(key);
  if (hit) {
    l1.delete(key); // refresh recency
    l1.set(key, hit);
  }
  return hit;
}

function l1Set(key: string, value: Promise<Outcome>): void {
  l1.set(key, value);
  while (l1.size > L1_MAX) {
    const oldest = l1.keys().next().value;
    if (oldest === undefined) break;
    l1.delete(oldest);
  }
}

function diskPath(key: string): string {
  return join(L2_DIR, `${key}.js`);
}

function diskRead(key: string): string | null {
  try {
    return readFileSync(diskPath(key), 'utf8');
  } catch {
    return null;
  }
}

function diskWrite(key: string, source: string): void {
  try {
    mkdirSync(L2_DIR, { recursive: true });
    writeFileSync(diskPath(key), source, 'utf8');
  } catch {
    // Best-effort: a read-only or full disk must not break rendering.
  }
}

async function produce(content: string, key: string): Promise<Outcome> {
  try {
    let source = diskRead(key);
    if (source === null) {
      source = await compileToSource(content); // the expensive step
      diskWrite(key, source);
    }
    const Content = await runSource(source);
    return { ok: true, Content };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function getCompiled(content: string): Promise<Outcome> {
  const key = cacheKey(content);
  const cached = l1Get(key);
  if (cached) return cached;
  const pending = produce(content, key);
  l1Set(key, pending);
  return pending;
}

/**
 * Attempt a full hardened compile of `content` and report whether it is valid
 * MDX (SPEC §5.4 / §6.1). Warms the compile cache as a side effect, so the
 * eventual render of the same content is a cache hit. Never throws.
 */
export async function validateMdx(content: string): Promise<{ ok: boolean; warnings: string[] }> {
  const outcome = await getCompiled(content);
  if (outcome.ok) return { ok: true, warnings: [] };
  return { ok: false, warnings: [`MDX failed to compile: ${outcome.reason}`] };
}

function projectionFromFile(file: { data?: Record<string, unknown> }): ProjectionResult | null {
  const projection = file.data?.[PROJECTION_FILE_DATA_KEY];
  return projection && typeof projection === 'object' && 'plainText' in projection
    ? (projection as ProjectionResult)
    : null;
}

/**
 * Project valid MDX through the same hardened remark stack the successful render
 * path compiles. Invalid MDX deliberately falls back to the plain-markdown
 * projection because the page will render through that fallback too.
 */
export async function projectMdx(content: string): Promise<ProjectionResult> {
  try {
    const file = await compile(content, {
      outputFormat: 'function-body',
      remarkPlugins: remarkPluginsForProjection(false),
    });
    return projectionFromFile(file) ?? project(content);
  } catch (error) {
    const fallback = project(content);
    return {
      ...fallback,
      mdxOk: false,
      warnings: [
        ...fallback.warnings,
        `MDX failed to compile: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

/**
 * Render imported MDX to React nodes (SPEC §6.1). Returns `ok: false` alongside a
 * plain-markdown fallback if the compile fails at render time — a belt to the
 * mdx_ok braces so the page never crashes even if validation and render ever
 * disagree. On success, resolves JSX against the imported-MDX allowlist only.
 */
export async function renderMdx(content: string): Promise<{ node: ReactNode; ok: boolean }> {
  const outcome = await getCompiled(content);
  if (!outcome.ok) {
    return { node: await renderMarkdown(content), ok: false };
  }
  const { Content } = outcome;
  return { node: <Content components={IMPORTED_MDX_COMPONENTS} />, ok: true };
}
