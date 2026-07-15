// Hand-written mirror of the API's integration payloads (SPEC §16). OpenAPI/TS
// codegen is accepted debt (TODOS.md); until then this is the web↔api contract.
// Keep in sync with api/app/Http/Resources/V1/IntegrationResource.php.
//
// The token is NEVER part of any payload — the API stores it encrypted and
// returns only the mask. There is deliberately no field here that could hold it.

/** M1 ships `github_pat` only; the GitHub App and Confluence arrive at M6. */
export type IntegrationProvider = 'github_pat';

/** A connected integration as its workspace manages it (masked). */
export interface Integration {
  id: number;
  provider: IntegrationProvider;
  /** The last four characters of the token — the only hint ever surfaced. */
  token_last_four: string | null;
  created_at: string | null;
}

/** GET /api/v1/integrations — the collection keeps the `data` envelope. */
export interface IntegrationList {
  data: Integration[];
}
