'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AgentToken, MintedAgentToken } from '@/lib/agent-token-types';
import { lastUsedDescriptor, withMintedToken, withoutToken } from '@/lib/agent-tokens';
import {
  listAgentTokens,
  mintAgentToken,
  revokeAgentToken,
} from '@/lib/agent-tokens-client';

// Agent-token management on the settings page (SPEC §15, user story 12, #131).
// A self-contained client island, mounted with a single line so a parallel edit
// on the settings page stays conflict-free.
//
// The surface is the Share-link idiom applied to a credential: name it, see the
// value exactly once in a copy box, then only its name and last-used remain.
// Revoke is immediate and final — the row disappears because the credential is
// gone, not disabled. DESIGN.md tokens, matching the integrations panel; chrome
// strings from the `agent-tokens` catalog.

export function AgentTokensPanel() {
  const t = useTranslations('agent-tokens');
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<MintedAgentToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  // "No tokens" and "the list did not load" must never look the same on a
  // revocation surface — an operator cutting an agent off has to know they are
  // looking at the real list.
  function load(): Promise<void> {
    return listAgentTokens().then((outcome) => {
      if (outcome.ok) {
        setTokens(outcome.tokens);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    });
  }

  useEffect(() => {
    let active = true;
    listAgentTokens()
      .then((outcome) => {
        if (!active) return;
        if (outcome.ok) setTokens(outcome.tokens);
        else setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function onMint() {
    const trimmed = name.trim();
    if (minting || trimmed === '') return;
    setMinting(true);
    setError(null);
    setCopied(false);

    try {
      const outcome = await mintAgentToken(trimmed);
      if (outcome.ok) {
        setMinted(outcome.token);
        setTokens((prev) => withMintedToken(prev, outcome.token));
        setName('');
      } else {
        setError(outcome.message);
        // The mint may have landed even though we cannot show its value, so
        // re-read the authoritative list rather than guess.
        await load();
      }
    } finally {
      setMinting(false);
    }
  }

  async function onCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t('copyFailed'));
    }
  }

  async function onRevoke(id: number) {
    if (revokingId) return;
    setRevokingId(id);
    setError(null);

    try {
      const outcome = await revokeAgentToken(id);
      if (outcome.ok) {
        setTokens((prev) => withoutToken(prev, id));
        // If the just-revoked token is the one on display, retire its copy box.
        setMinted((current) => (current && current.id === id ? null : current));
      } else {
        setError(outcome.message);
      }
    } finally {
      setRevokingId(null);
    }
  }

  function lastUsedLabel(token: AgentToken): string {
    const descriptor = lastUsedDescriptor(token);
    return descriptor.kind === 'never'
      ? t('neverUsed')
      : t('lastUsedAt', { date: descriptor.date });
  }

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
          {t('heading')}
        </h2>
        {tokens.length > 0 ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-500">
            {t('activeCount', { count: tokens.length })}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {t.rich('intro', {
          strong: (chunks) => (
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{chunks}</span>
          ),
        })}
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={80}
          placeholder={t('namePlaceholder')}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          aria-label={t('nameAria')}
          aria-invalid={Boolean(error)}
          className={`w-full min-w-0 flex-1 rounded-xl bg-white px-3.5 py-2 text-sm text-zinc-900 ring-1 ring-inset placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 dark:bg-white/[.03] dark:text-white ${
            error
              ? 'ring-rose-500/50 focus-visible:ring-rose-500'
              : 'ring-zinc-900/10 focus-visible:ring-emerald-500 dark:ring-white/10'
          }`}
        />
        <button
          type="button"
          onClick={onMint}
          disabled={minting || name.trim() === ''}
          className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
        >
          {minting ? t('creating') : t('create')}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      {minted ? (
        <div className="mt-4 rounded-xl bg-emerald-500/5 p-4 ring-1 ring-emerald-500/20">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            {t('createdOnce')}
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              readOnly
              value={minted.value}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={t('valueAria')}
              className="w-full min-w-0 flex-1 rounded-lg bg-white px-3 py-1.5 font-mono text-xs text-zinc-800 ring-1 ring-inset ring-zinc-900/10 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-white/10"
            />
            <button
              type="button"
              onClick={() => onCopy(minted.value)}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
            >
              {copied ? t('copied') : t('copy')}
            </button>
            {/* Stored the token? Take it off the screen. Without this the value
                sits in an unattended tab until something else clears it. */}
            <button
              type="button"
              onClick={() => {
                setMinted(null);
                setCopied(false);
              }}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-900/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/5"
            >
              {t('dismiss')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">{t('loading')}</p>
        ) : loadFailed ? (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {t('loadFailed')}
          </p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">{t('none')}</p>
        ) : (
          <ul className="divide-y divide-zinc-900/5 dark:divide-white/5">
            {tokens.map((token) => (
              <li key={token.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">
                      {t('badge')}
                    </span>
                    <span className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                      {token.name}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
                    {lastUsedLabel(token)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(token.id)}
                  disabled={revokingId === token.id}
                  className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-rose-600 ring-1 ring-inset ring-rose-500/30 hover:bg-rose-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-60 dark:text-rose-400"
                >
                  {revokingId === token.id ? t('revoking') : t('revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-4 text-xs leading-5 text-zinc-500 dark:text-zinc-500">
        {t('scopeHint')}
      </p>
    </section>
  );
}
