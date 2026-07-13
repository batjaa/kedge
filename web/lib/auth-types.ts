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
}
