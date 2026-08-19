import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

// Spawns the real MCP client (`e2e/mcp-agent.mjs`) as a separate process and
// parses its one line of JSON. Out of process on purpose: the agent shares
// nothing with the browser or the Playwright runner but a token and a URL —
// exactly what a third-party agent has.
//
// The endpoint is the SERVED api on IPv4 loopback, the same host every other
// Node-side hop in the pack uses (playwright.config.ts explains why: Node
// resolves `localhost` to ::1, where the PHP dev server does not listen).

const API_PORT = 8000;

export const MCP_ENDPOINT = `http://127.0.0.1:${API_PORT}/api/v1/mcp`;

// Resolved from the runner's cwd (the `web/` package, where playwright.config.ts
// lives), the same way e2e/mailbox.ts finds the api's log mailbox.
const SCRIPT = resolve(process.cwd(), 'e2e/mcp-agent.mjs');

export interface McpAgentSuccess {
  ok: true;
  command: string;
  tools?: string[];
  document?: { id: number; title: string };
  version?: { id: number; projection_version: string };
  thread?: { id: number | null; anchor_exact: string | null };
  comment?: { id: number; client: string; body_md: string } | null;
  documents?: Array<{ id: number; title: string }>;
}

export interface McpAgentFailure {
  ok: false;
  command: string;
  /** The HTTP status the server answered with; 401 for a revoked token. */
  status: number | null;
  message: string;
}

export type McpAgentResult = McpAgentSuccess | McpAgentFailure;

interface ReviewOptions {
  token: string;
  title: string;
  /** Text from the version's projection the agent anchors its comment to. */
  anchor: string;
  body: string;
}

/** The agent's review pass: list → read → post an anchored comment. */
export async function mcpAgentReview(options: ReviewOptions): Promise<McpAgentResult> {
  return run([
    '--command', 'review',
    '--token', options.token,
    '--title', options.title,
    '--anchor', options.anchor,
    '--body', options.body,
  ]);
}

/** The cheapest real tool call, for probing whether a token still works. */
export async function mcpAgentListDocuments(token: string): Promise<McpAgentResult> {
  return run(['--command', 'list-documents', '--token', token]);
}

function run(args: string[]): Promise<McpAgentResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [SCRIPT, '--endpoint', MCP_ENDPOINT, ...args],
      { timeout: 30_000 },
      (error, stdout, stderr) => {
        // A non-zero exit is how the script reports a refused call, so the
        // payload — not the exit code — decides. Only an unparseable stdout is
        // a genuine harness failure.
        const line = stdout.trim().split('\n').at(-1) ?? '';

        try {
          resolve(JSON.parse(line) as McpAgentResult);
        } catch {
          reject(new Error(
            `mcp-agent.mjs produced no JSON (exit ${error?.code ?? 0}).\nstdout: ${stdout}\nstderr: ${stderr}`,
          ));
        }
      },
    );
  });
}
