# Symphony delivery workflow

Add `agent-ready` to an actionable GitHub issue to authorize implementation,
independent agent review, bounded repair and eligible automatic merge. Describe
the outcome, acceptance criteria, spec/design references, verification and delivery
scope. Native blocking dependencies and `Blocked-by: #123` / `Depends-on:
owner/repo#123` are checked before work and delivery. Resolve product and visual
direction with the owner before queueing; a clear small fix needs no separate spec.

One builder runs at a time in an isolated checkout on the maintainer's M3.
It follows AGENTS.md and the agreed spec, adds meaningful behavior tests, verifies
the change, commits coherent units and opens a PR using `Refs #N`. Never put
automatic closing keywords in PRs or commits: a partial PR must not close a ticket.
The repository's rule that in-product AI output is human-confirmed remains intact;
this maintainer-authorized development workflow does not change product behavior.

## Delivery gates

The host reruns local checks on the clean pushed commit, then starts a separate,
ephemeral read-only Codex reviewer with the issue, spec, diff and evidence.
Correctness, spec agreement, repository standards and complexity are reviewed.
UI work requires a running preview and visual evidence against DESIGN.md and its
approved mockups. App tests alone do not verify appearance or live integrations.

All three existing GitHub Actions jobs must succeed on the current head:

- `API (Pint + PHPUnit)`
- `Web (types:check + build)` (also runs Vitest)
- `E2E (Playwright journeys)`

After local tests, independent approval and CI pass, the host fast-forwards `main`
to the exact tested commit without force. Concurrent divergent changes to main
reject the update and return work to verification. GitHub records the PR as
indirectly merged. If main becomes protected, the pilot stops for a compatible
delivery policy rather than bypassing PR requirements. This is an operational
guardrail using the owner's identity, not a second person's GitHub approval or a
sandbox against malicious repository code.

There are four builder attempts per ticket: initial implementation plus up to
three repairs, shared across any partial PRs. State and findings persist outside
the checkout and survive restarts. Rework stays on the same branch/PR; another
slice after a merge receives a new part branch. The original issue closes only
after all coding acceptance is complete and any requested release is verified.

- `agent-ready` stays on during implementation, review, CI and repair.
- `agent-review` means a product/design decision or exhausted attempt budget.
- `agent-blocked` means a dependency, environment, access or release prerequisite.

One progress comment records evidence and the next action. After resolving a
handoff, reapply `agent-ready`. Exhausted counters require an explicit operator
reset; requeueing alone does not reset them. Dependencies do not auto-requeue.

## Local verification contract

Prerequisites: PHP 8.5+ (SQLite and mbstring extensions), Composer, Node 20.9+ and npm.

```sh
scripts/agent bootstrap  # Composer lock + npm ci; creates only a missing local API env
scripts/agent verify     # Pint, PHPUnit, web types, Vitest and production build
```

Use a disposable checkout. Do not copy production env files or run migrations
against an existing deployment. PHPUnit uses in-memory SQLite; AI tests are
mocked/off by default. The browser journey pack is a mandatory CI gate and uses
CI's dedicated Kroki containers and scratch database. The M3 does not need Docker
to run the local contract. Do not run the full E2E pack there against reused app
ports or hosted Kroki; provision isolated local services first if a ticket needs
local browser diagnosis. Any paid/live-provider test requires an explicit budget.

## Release verification and operation

Kedge runs through Coolify; see [the preview deployment guide](../deploy/preview/README.md).
The host flow does not invoke deployment or assume a merge deployed successfully.
Finish every coding slice first. If release is part of acceptance, keep the issue
open with `agent-blocked` until an operator verifies the intended revision and
the ticket's smoke checks in the target environment. A healthy old deployment is
not evidence that a new revision shipped.

On the M3, configuration lives in `~/git/symphony-ops`; durable state is under
`~/.local/share/symphony/state/kedge`. Review evidence should be inspected before
resetting an exhausted budget with `python3 ~/git/symphony-ops/kedge_flow.py reset
--issue N`. An uncertain merge receipt requires reconciling GitHub separately.
The flow is a project profile over the same delivery gates as the Jolly pilot.
