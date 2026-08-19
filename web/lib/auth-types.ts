// Hand-written mirror of the API's who-am-I payload and Laravel's validation
// error shape. OpenAPI/TS codegen is accepted debt (TODOS.md); until then these
// types are the web↔api auth contract. Keep in sync with
// api/app/Http/Resources/V1/{CurrentUser,User,Workspace}Resource.php.

export interface User {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
}

export interface Workspace {
  id: number;
  name: string;
  slug: string;
}

/** GET /api/v1/me, and the register/login responses, all return this shape. */
export interface Session {
  user: User;
  workspace: Workspace;
}

/** Laravel 422 body: a top-level message plus per-field error lists. */
export interface ValidationErrorBody {
  message: string;
  errors: Record<string, string[]>;
}

/**
 * Runtime capabilities the API reports at GET /api/v1/config — credential-gated
 * features the web app must not offer unless the API has switched them on.
 * Mirrors api/app/Http/Controllers/Api/V1/ConfigController.php.
 */
export interface Capabilities {
  /** One-click GitHub sign-in — true only when the API has OAuth credentials. */
  github: boolean;
  /**
   * Self-hosted edition (#25). Drives the anonymous home surface: false (SaaS)
   * shows the instant-demo paste box; true keeps the sign-in redirect. Fails
   * closed to true if the API can't be reached, so the public demo surface never
   * shows on an instance we can't confirm is the SaaS.
   */
  selfHosted: boolean;
  /**
   * AI features (SPEC §14, M4). True only when the API has an Anthropic key
   * configured. Fails closed — including when the payload carries no `ai` block
   * at all (a new web against an older api) — so an unconfigured instance shows
   * no AI affordance rather than a button that 404s.
   */
  ai: boolean;
}
