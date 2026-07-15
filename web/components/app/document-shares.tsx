'use client';

import { useEffect, useState } from 'react';
import type { CreatedShare, Share, ShareStatus } from '@/lib/share-types';
import { createShare, listShares, revokeShare } from '@/lib/shares-client';

// Share-link management on the document page (SPEC 10.2, ticket #24). A
// self-contained client island: it loads the document's shares, mints new
// unguessable links (surfacing the one-time URL to copy), and revokes them.
// Mounted with a single line on the doc page so a parallel edit there stays
// conflict-free.

const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: 'No expiry', days: null },
  { label: 'Expires in 7 days', days: 7 },
  { label: 'Expires in 30 days', days: 30 },
];

export function DocumentShares({ documentId }: { documentId: number }) {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedShare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    listShares(documentId)
      .then((list) => {
        if (active) setShares(list);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [documentId]);

  async function onCreate() {
    if (creating) return;
    setCreating(true);
    setError(null);
    setCopied(false);

    const outcome = await createShare(documentId, expiryDays);
    if (outcome.ok) {
      setCreated(outcome.share);
      setShares((prev) => [outcome.share, ...prev]);
    } else {
      setError(outcome.message);
    }
    setCreating(false);
  }

  async function onCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed — select the link and copy it manually.');
    }
  }

  async function onRevoke(id: number) {
    if (revokingId) return;
    setRevokingId(id);
    setError(null);

    const outcome = await revokeShare(documentId, id);
    if (outcome.ok) {
      setShares((prev) => prev.map((s) => (s.id === id ? outcome.share : s)));
      // If the just-revoked link is the one on display, retire its copy box.
      setCreated((c) => (c && c.id === id ? null : c));
    } else {
      setError(outcome.message);
    }
    setRevokingId(null);
  }

  const activeCount = shares.filter((s) => s.status === 'active').length;

  return (
    <section className="mt-10 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Share links</h2>
        {activeCount > 0 ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-500">
            {activeCount} active {activeCount === 1 ? 'link' : 'links'}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        Create an unguessable read-only link so reviewers can read this document without an
        account. Revoke it any time.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <select
          value={expiryDays ?? ''}
          onChange={(e) => setExpiryDays(e.target.value === '' ? null : Number(e.target.value))}
          className="rounded-xl bg-white px-3.5 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-900/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-white/10"
        >
          {EXPIRY_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.days ?? ''}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
        >
          {creating ? 'Creating…' : 'Create share link'}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      {created ? (
        <div className="mt-4 rounded-xl bg-emerald-500/5 p-4 ring-1 ring-emerald-500/20">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Copy this link now — it is shown only once.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              readOnly
              value={created.url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full min-w-0 flex-1 rounded-lg bg-white px-3 py-1.5 font-mono text-xs text-zinc-800 ring-1 ring-inset ring-zinc-900/10 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-white/10"
            />
            <button
              type="button"
              onClick={() => onCopy(created.url)}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading links…</p>
        ) : shares.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">No share links yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-900/5 dark:divide-white/5">
            {shares.map((share) => (
              <li key={share.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={share.status} />
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">
                      Link #{share.id}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
                    {expiryLabel(share)}
                  </p>
                </div>
                {share.status === 'active' ? (
                  <button
                    type="button"
                    onClick={() => onRevoke(share.id)}
                    disabled={revokingId === share.id}
                    className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-rose-600 ring-1 ring-inset ring-rose-500/30 hover:bg-rose-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-60 dark:text-rose-400"
                  >
                    {revokingId === share.id ? 'Revoking…' : 'Revoke'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: ShareStatus }) {
  const styles: Record<ShareStatus, string> = {
    active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    revoked: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
    expired: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  };
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function expiryLabel(share: Share): string {
  if (share.status === 'revoked' && share.revoked_at) {
    return `Revoked ${formatDate(share.revoked_at)}`;
  }
  if (share.expires_at) {
    const verb = share.status === 'expired' ? 'Expired' : 'Expires';
    return `${verb} ${formatDate(share.expires_at)}`;
  }
  return 'Never expires';
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
