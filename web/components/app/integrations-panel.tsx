'use client';

import { useEffect, useState } from 'react';
import type { Integration } from '@/lib/integration-types';
import {
  connectIntegration,
  disconnectIntegration,
  listIntegrations,
} from '@/lib/integrations-client';

// Integration management on the settings page (SPEC §16, ticket #23). A
// self-contained client island: it lists the workspace's connected credentials
// (masked to a last-4 hint), connects a GitHub PAT (a password-type input, never
// echoed back), and removes one. The token is sent once and never returned.
// DESIGN.md tokens, matching the share panel.

// Deep-link to GitHub's fine-grained token form pre-filled with the MINIMUM
// Kedge needs (#43): Contents read-only (Metadata read is implied), a bounded
// expiry, and a recognizable name. Repository selection can't be pre-filled —
// the copy below tells the user to pick "Only select repositories".
//
// Resource owner (#45): a fine-grained token is scoped to ONE owner and the
// form defaults to the personal account, so org-owned repos don't appear
// unless the org is the owner. Switching owner INSIDE the form drops the
// pre-filled permissions, but `target_name` in the URL pre-fills it safely —
// hence the optional org input. Collaborator-only repos on someone else's
// account are a hard fine-grained limitation → classic-token fallback link.
function newTokenUrl(org: string): string {
  const owner = org.trim();
  return (
    'https://github.com/settings/personal-access-tokens/new' +
    '?name=Kedge%20imports' +
    '&description=Read-only%20access%20so%20Kedge%20can%20import%20specs%20for%20review.' +
    '&contents=read' +
    '&expires_in=90' +
    (owner ? `&target_name=${encodeURIComponent(owner)}` : '')
  );
}

const CLASSIC_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo&description=Kedge%20imports';

export function IntegrationsPanel() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [org, setOrg] = useState('');

  useEffect(() => {
    let active = true;
    listIntegrations()
      .then((list) => {
        if (active) setIntegrations(list);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function onConnect() {
    const trimmed = token.trim();
    if (connecting || trimmed === '') return;
    setConnecting(true);
    setError(null);
    setNotice(null);

    const outcome = await connectIntegration(trimmed);
    if (outcome.ok) {
      setIntegrations((prev) => [outcome.integration, ...prev]);
      setToken('');
      setNotice('GitHub connected. Private repositories now import through this token.');
    } else {
      setError(outcome.message);
    }
    setConnecting(false);
  }

  async function onRemove(id: number) {
    if (removingId) return;
    setRemovingId(id);
    setError(null);
    setNotice(null);

    const outcome = await disconnectIntegration(id);
    if (outcome.ok) {
      setIntegrations((prev) => prev.filter((i) => i.id !== id));
    } else {
      setError(outcome.message);
    }
    setRemovingId(null);
  }

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">GitHub</h2>
        {integrations.length > 0 ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-500">
            {integrations.length} connected
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        Connect a{' '}
        <a
          href={newTokenUrl(org)}
          target="_blank"
          rel="noreferrer"
          className="text-emerald-600 underline-offset-2 hover:underline dark:text-emerald-400"
        >
          fine-grained personal access token
        </a>{' '}
        to import files from private repositories. The link pre-selects the minimum Kedge needs
        (<span className="font-medium text-zinc-700 dark:text-zinc-300">Contents: read-only</span>)
        — just choose{' '}
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          &ldquo;Only select repositories&rdquo;
        </span>{' '}
        and pick the repos to review. The token is encrypted and never shown again — remove it any
        time.
      </p>

      <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <label
          htmlFor="pat-org"
          className="shrink-0 text-xs font-medium text-zinc-600 dark:text-zinc-400"
        >
          Repos owned by an organization?
        </label>
        <input
          id="pat-org"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="org name (optional)"
          value={org}
          onChange={(e) => setOrg(e.target.value)}
          className="w-full rounded-xl bg-white px-3 py-1.5 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-900/10 placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-white/10 sm:max-w-56"
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-500">
        A fine-grained token sees one owner&apos;s repos: yours by default, or one organization —
        enter it above so the link opens pre-scoped (changing the owner inside GitHub&apos;s form
        resets the pre-filled permissions). Orgs can block these tokens or require approval. For a
        private repo owned by another user where you&apos;re a collaborator, fine-grained tokens
        can&apos;t help — use a{' '}
        <a
          href={CLASSIC_TOKEN_URL}
          target="_blank"
          rel="noreferrer"
          className="text-emerald-600 underline-offset-2 hover:underline dark:text-emerald-400"
        >
          classic token
        </a>{' '}
        (broader <code className="font-mono">repo</code> scope) instead.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="ghp_… or github_pat_…"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            if (error) setError(null);
          }}
          aria-label="GitHub personal access token"
          aria-invalid={Boolean(error)}
          className={`w-full min-w-0 flex-1 rounded-xl bg-white px-3.5 py-2 font-mono text-sm text-zinc-900 ring-1 ring-inset placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 dark:bg-white/[.03] dark:text-white ${
            error
              ? 'ring-rose-500/50 focus-visible:ring-rose-500'
              : 'ring-zinc-900/10 focus-visible:ring-emerald-500 dark:ring-white/10'
          }`}
        />
        <button
          type="button"
          onClick={onConnect}
          disabled={connecting || token.trim() === ''}
          className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
        >
          {connecting ? 'Connecting…' : 'Connect'}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>
      ) : null}

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading connections…</p>
        ) : integrations.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            No tokens connected yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-900/5 dark:divide-white/5">
            {integrations.map((integration) => (
              <li
                key={integration.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                      GitHub PAT
                    </span>
                    <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                      {integration.token_last_four
                        ? `••••${integration.token_last_four}`
                        : '••••'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
                    {connectedLabel(integration)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(integration.id)}
                  disabled={removingId === integration.id}
                  className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-rose-600 ring-1 ring-inset ring-rose-500/30 hover:bg-rose-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-60 dark:text-rose-400"
                >
                  {removingId === integration.id ? 'Removing…' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function connectedLabel(integration: Integration): string {
  if (!integration.created_at) return 'Connected';
  const date = new Date(integration.created_at);
  return Number.isNaN(date.getTime())
    ? 'Connected'
    : `Connected ${date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })}`;
}
