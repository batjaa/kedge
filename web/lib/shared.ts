export const appName = 'Kedge';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

// Placeholder until the public repo exists (name/domain pending, SPEC §22.1)
export const gitConfig = {
  user: 'batjaa',
  repo: 'kedge',
  branch: 'main',
};

// The landing's final CTA collects an email before routing to /signup, and hands
// it to the signup form through sessionStorage under this key — never through a
// query param, which would leak PII into server logs and history.
export const signupEmailHandoffKey = 'kedge.signup-email';
