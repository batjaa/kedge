// Hand-written mirror of the API's agent-token payloads (SPEC §15, #131).
// OpenAPI/TS codegen is accepted debt (TODOS.md); until then this is the
// web↔api contract. Keep in sync with
// api/app/Http/Resources/V1/AgentTokenResource.php.
//
// The token value appears in exactly one payload — the mint response — because
// that is the only moment it exists. There is deliberately no field for it on
// the listed shape, so no listing code path can ever try to show one.

/** An Agent Token as its owner manages it (the settings list). */
export interface AgentToken {
  id: number;
  name: string;
  /** Sanctum's own stamp, written every time the agent authenticates. */
  last_used_at: string | null;
  created_at: string | null;
}

/**
 * The mint response — an {@link AgentToken} plus its one-time value. `value` is
 * present only here; the API stores nothing but a digest, so it is never
 * returned again.
 */
export interface MintedAgentToken extends AgentToken {
  value: string;
}

/** GET /api/v1/agent-tokens — the collection keeps the `data` envelope. */
export interface AgentTokenList {
  data: AgentToken[];
}
