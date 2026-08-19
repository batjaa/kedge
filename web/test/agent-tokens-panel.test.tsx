import { renderToStaticMarkup } from './render-intl';
import { describe, expect, it } from 'vitest';
import { AgentTokensPanel } from '@/components/app/agent-tokens-panel';

// Static-markup coverage for the agent-token settings surface (SPEC §15, user
// story 12, #131). The panel is a client island, but its initial render — the
// heading, the naming form, and the MCP-only promise — is a pure function of the
// catalog, so renderToStaticMarkup exercises the copy that carries the product
// claim.

describe('AgentTokensPanel', () => {
  const html = renderToStaticMarkup(<AgentTokensPanel />);

  it('offers a named token, not an anonymous one', () => {
    expect(html).toContain('Agent tokens');
    expect(html).toContain('Create token');
    expect(html).toContain('aria-label="Agent token name"');
  });

  it('states the MCP-only rule where the operator mints the credential', () => {
    expect(html).toContain('on the agent endpoint');
    expect(html).toContain('never on the rest of the API');
    expect(html).toContain('or create another token');
  });

  it('warns that revocation is immediate before anything is minted', () => {
    // Rendered markup escapes the apostrophe.
    expect(html).toContain('next call fails');
    expect(html).toContain('Revoking is immediate');
  });

  it('renders localized chrome', () => {
    const mn = renderToStaticMarkup(<AgentTokensPanel />, 'mn-MN');

    expect(mn).toContain('Агентын token');
    expect(mn).toContain('Token үүсгэх');
  });
});
