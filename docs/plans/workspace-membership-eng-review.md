# Workspace membership — engineering review

> Started 2026-09-27 · In progress; no implementation or ticket publication.
> Source: [M4.0 workspace membership spec](../specs/m4.0-workspace-membership.md).
> Prior [project review](project-access-eng-review.md) supplies reusable decisions;
> it does not automatically approve the new workspace architecture or matrix.

## Progress

| Review section | Status |
|---|---|
| Step 0 — scope | Complete: 1A, full scope retained |
| 1 — architecture | In progress |
| 2 — error and rescue map | Pending |
| 3 — security and threat model | Pending |
| 4 — data flow and interaction edge cases | Pending |
| 5 — code quality | Pending |
| 6 — tests and coverage diagram | Pending |
| 7 — performance | Pending |
| 8 — observability | Pending |
| 9 — deployment | Pending |
| 10 — long-term trajectory | Pending |
| 11 — design and UX | Pending |

## Accepted decisions

### 1A — retain the complete scope

User selected 1A on 2026-09-27. Keep the entire M4.0 spec and deliver it in
reviewable slices, including source configuration and complete paginated scan
reports. Do not reopen scope reduction in later sections. The architecture,
invitation lifecycle, resource authorization, queued-result checks, private assets,
recovery, testing and operating requirements remain release requirements.

Reuse existing Laravel/application boundaries instead of adding a second
permission platform. The user's earlier deployment decision also stands: ordinary
migration, process restarts and smoke checks; temporary disruption/manual recovery
are accepted. No maintenance cutover, forced queue drain or fleet-version gate.

## What already exists

| Sub-problem | Existing implementation | Review direction |
|---|---|---|
| Tenancy and membership | Workspace, WorkspaceMember pivot, User workspace relations | Extend existing records and IDs; inspect lifecycle/query semantics |
| Route authorization | Laravel Policies and shared membership/share concerns | Keep enforcement entry points; centralize role/action decisions |
| Accounts and mailbox proof | Registration, reviewer upgrade, email confirmation, OAuth and shared sign-out | Reuse; preserve recent auth fixes and cover documented logout-race debt |
| Agent identity | Sanctum-backed AgentToken, exact workspace abilities and write-time token checks | Compose with live membership and the shared transaction boundary |
| AI generation | AiRunStarter, run ledger and conditional transitions | Consolidate starts; retain privacy, deduplication and accounting |
| Import and scans | Existing source/import/tracked-repo services and jobs | Add authority/operation evidence around their behavior |
| Delivery and recovery | Database queue, configured mail transport, Compose worker/scheduler | Reuse; validate durable invitation enqueue and independent cleanup |
| Test seams | PHPUnit API/MCP tests, database concurrency checks and Playwright journeys | Extend agreed seams; coverage mapping remains pending |

## NOT in scope

- Custom-role editing or a policy-expression engine: preserve the extensible
  contract while shipping explicit built-in definitions.
- Direct project memberships and repository delegation: subsequent project module
  will reuse this foundation after its old ticket structure is rebased.
- Private-project exclusions, workspace-wide identity bans or bulk offboarding of
  independent grants: distinct future product semantics.
- Multiple Owners, ownership transfer, extra workspace creation or deletion UI:
  personal provisioning and protected ownership remain the selected starting point.
- Billing, SSO/SCIM, team groups, domain auto-join and bulk invitations: independent
  capabilities outside the workspace-membership foundation.
- New MCP administration tools, automatic AI posting and new source connectors:
  this work changes authority for existing capabilities.
- Maintenance cutover, seamless downgrade or additional distribution artifacts:
  ordinary deployment and existing application distribution remain sufficient.

## Review baseline

At review start, main contains local workspace-planning commits 08a734d and
d2afd25; GitHub reports no open PRs and the local stash is empty. Unrelated README
and deployment-note changes are left untouched. Prior review-driven work in git
history includes queued authority, scan results, logout, private assets and AI
starts; these areas require verification against code, not assumptions that a
planning commit implemented them. No application tests have run in this review.
