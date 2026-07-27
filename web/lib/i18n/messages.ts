import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LOCALE, type Locale } from './config';

// Message-catalog loading and the en-US deep-merge fallback (eng-review B1).
//
// Catalogs live at web/messages/<locale>/<namespace>.json — one file PER SURFACE
// per locale (see messages/README.md). The set of namespaces is DISCOVERED from
// the en-US directory at load time, so the parallel M3.9 surface tickets each ADD
// their own <surface>.json files and are picked up automatically — no shared
// registry to edit, no merge conflicts between batches. en-US is the source of
// truth for which namespaces (and keys) exist; the CI parity test holds the other
// three catalogs to that shape.
//
// Server-only: this reads the filesystem and must never be imported into a Client
// Component. The web image ships the full source tree and runs `next start`
// (web/Dockerfile), so process.cwd()/messages is present at runtime in every
// edition.

export type MessageTree = { [key: string]: string | MessageTree };

const MESSAGES_DIR = path.join(process.cwd(), 'messages');

function isMessageTree(value: unknown): value is MessageTree {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Deep-merge `override` onto `base`, returning a new tree. A key present in
 * `override` wins; a key ABSENT from `override` keeps the `base` value. This is
 * the fallback primitive: with base = en-US and override = a locale catalog, a
 * gap in the locale renders the English string, never a raw key path (B1). An
 * explicitly-provided empty string is a translation, not a gap, and is kept.
 */
export function deepMerge(base: MessageTree, override: MessageTree): MessageTree {
  const out: MessageTree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (isMessageTree(value) && isMessageTree(existing)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Flatten a catalog to its set of leaf key paths (dot-separated). */
export function flattenKeys(tree: MessageTree, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (isMessageTree(value)) {
      keys.push(...flattenKeys(value, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

/** Key paths present in `base` but missing from `candidate` — the dev-log signal. */
export function missingKeys(base: MessageTree, candidate: MessageTree): string[] {
  const have = new Set(flattenKeys(candidate));
  return flattenKeys(base).filter((key) => !have.has(key));
}

/** The namespaces to load, discovered from the en-US catalog directory. */
export function listNamespaces(): string[] {
  const dir = path.join(MESSAGES_DIR, DEFAULT_LOCALE);
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort();
}

/** Read one raw catalog file, or null when the locale doesn't define it. */
export function readCatalog(locale: Locale, namespace: string): MessageTree | null {
  const file = path.join(MESSAGES_DIR, locale, `${namespace}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as MessageTree;
}

const cache = new Map<Locale, MessageTree>();
const isProd = process.env.NODE_ENV === 'production';

/**
 * Load the merged message tree for a locale: every namespace, each deep-merged
 * under its en-US counterpart. The result is keyed by namespace, so surfaces
 * added by later tickets never collide on a top-level key. Cached in production
 * (catalogs are static at runtime); uncached in dev so catalog edits hot-reload.
 */
export function loadMessages(locale: Locale): MessageTree {
  const cached = cache.get(locale);
  if (cached) return cached;

  const merged: MessageTree = {};
  for (const namespace of listNamespaces()) {
    const base = readCatalog(DEFAULT_LOCALE, namespace) ?? {};
    const override = locale === DEFAULT_LOCALE ? null : readCatalog(locale, namespace);
    merged[namespace] = override ? deepMerge(base, override) : base;
  }

  if (isProd) cache.set(locale, merged);
  return merged;
}
