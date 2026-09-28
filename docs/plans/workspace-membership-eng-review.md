# Workspace membership — engineering review

> Started 2026-09-27 · In progress; no implementation or ticket publication.
> Source: [M4.0 workspace membership spec](../specs/m4.0-workspace-membership.md).
> Prior [project review](project-access-eng-review.md) supplies reusable decisions;
> it does not automatically approve the new workspace architecture or matrix.

## Progress

| Review section | Status |
|---|---|
| Step 0 — scope | Complete: 1A, full scope retained |
| 1 — architecture | Complete: four findings resolved (2A–5A) |
| 2 — error and rescue map | In progress: 6A accepted; 22 paths mapped, AI replay decision 7 pending |
| 3 — security and threat model | Preliminary inspection started; pending completion after decision 7 |
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

### 2A — first-class membership lifecycle and active access queries

Accepted through the user's explicit direction on 2026-09-27: refactoring and
migration time are not constraints worth preserving an inferior architecture for;
choose the cleaner end state. Promote the membership pivot to a lifecycle model,
use active-only relationship reads and a shared active-grant query, and make
historical/revoked access explicit. Lifecycle mutation/locking still needs an
unfiltered identity query, so do not hide inactive rows behind a global scope.

Evidence: the spec retains revoked rows, while current membership checks use
`$user->workspaces()->whereKey($workspaceId)->exists()` in
`api/app/Policies/Concerns/AuthorizesWorkspaceMembership.php:52` and raw existence
queries in `api/app/Http/Resources/V1/ThreadCapabilities.php:120`,
`api/app/Http/Resources/V1/CommentCapabilities.php:127` and
`api/app/Services/Comments/CommentMentionService.php:154`. This is a verified
integration risk for the proposed lifecycle, not a claim that revoked-state rows
are already implemented. P1, confidence 9/10.

Replace attach/detach/sync lifecycle paths, the closed enum role cast and direct
membership-based capability bypasses. Preserve registration, historical attribution
and explicit reactivation without granting access from history. Require feature
coverage across lifecycle, relations, Policies, directory/mentions, AI, capabilities
and MCP. No application implementation has started.

For remaining decisions, prefer correctness, clear boundaries and long-term
maintenance. Do not offer retaining a weaker structure merely to save refactoring
time; substantive product/API tradeoffs still require review.

### 3A — explicit workspace routes replace personal aliases

User selected 3A on 2026-09-27. Remove superseded personal-workspace collection,
create and settings aliases. Refactor API, web/BFF clients, validation, Policies,
queries, services, audit and queued-work admission around one explicit target.
MCP resolves its token workspace, not the owner's personal workspace; resource-ID
routes derive the target from stored ownership. No ambient session/global target.
Personal workspace identity and `/me` retain their personal meaning.

Evidence: the previous spec preserved aliases, while
`api/app/Http/Requests/StoreProjectRequest.php:27` scopes validation using
`$this->user()?->personalWorkspace()?->id` and
`api/app/Mcp/Tools/ListDocumentsTool.php:55` lists through
`$agent->personalWorkspace()->documents()`. Joined-workspace support must replace
these deeper assumptions, not just change controller routes.

The user accepts removing the extra compatibility surface. This explicitly
supersedes the generic additive-only v1 API convention for the affected routes;
ordinary deployment with temporary interruption remains accepted. Test the full
request target through validation, persistence/audit/jobs and MCP, parent/child
mismatches, absence of working old aliases, multi-tab targeting and stable personal
identity. Commit-time checks remain fresh.

### 4A — explicit share-review routes, without legacy compatibility

Accepted through the user's direction on 2026-09-27: existing shared links and
clients need not keep working; there are no production users, so build the clean
contract now. Use dedicated `/shared/{token}/…` review routes over shared business
services. The selected share/document and exact verified participant supply write
authority. Token possession alone remains read-only. Workspace and MCP requests
must not silently fall back to share permissions, nor share requests to membership.

Evidence: `api/app/Policies/Concerns/ResolvesShareReviewers.php:32–33` returns
`$this->memberOf($user, $document) || $this->reviewerOf($user, $document)`, and
`api/app/Policies/ThreadPolicy.php:21–30` uses it for create/reply. The shared review
client currently posts to the same document-ID routes. This is an integration gap
between the proposed separate surfaces and the existing implementation, P1,
confidence 9/10; it is not evidence of a deployed workspace-role regression.

Refactor route/context adapters, client calls, Policy/capability/mention decisions,
cache keys and commit guards together. Require exact-share, wrong-child,
revocation-race, token-only-write-denial and no-fallback tests. Preserve future
independent Share semantics, but do not build compatibility aliases, redirect
bridges or old-link migration. Update route and security documentation accordingly.

The user's broader instruction applies through the remaining review: backward
compatibility is not a pre-customer release requirement. Prefer a clear and correct
end state; continue to preserve intended domain behavior and data deliberately.

### 5A — claim demos only after the import settles

User selected 5A on 2026-09-27. Anonymous demo imports receive narrowly scoped
operation authority for one document/generation/public source in the reserved
system workspace, never a synthetic membership or unrestricted null-actor bypass.
Claim requires ready/failed terminal state with no active content operation. An
active/retrying import returns `409 demo_import_in_progress` without mutation.
The UI waits for settlement and requires an explicit claim submission. Failed
imports can be claimed and separately retried under current member authority.

Evidence: `api/app/Http/Controllers/Api/V1/DemoDocumentController.php:85` persists
`'created_by' => null` and dispatches the shared import job at line 113, while
`api/app/Http/Controllers/Api/V1/ClaimDocumentController.php:46–50` immediately
changes `workspace_id`, `created_by` and `expires_at`. The new membership-bound
job contract needs this explicit non-member path and terminal handoff. P1,
confidence 9/10, planned integration gap rather than a claimed runtime test result.

Serialize claim, import settlement and prune against current operation/placement
and expiry. Claim invalidates old demo authority; late success/failure/cleanup and
redelivery cannot mutate a claimed document. Destination membership is checked
fresh; no automatic retry or import-authority transfer. The system workspace has
no Owner/member and is excluded from ordinary membership administration. Add
CRITICAL regression coverage for anonymous import and both successful/failed claim
journeys, active claims, late worker callbacks, expiration, concurrent claims and
prune races. This preserves intended demo behavior without promising old-client
compatibility.

### 6A — RFC 9457 HTTP failures and explicit recovery

User selected 6A on 2026-09-27. Use centralized Laravel Problem Details rendering
and shared client decoding across affected HTTP flows. Keep native MCP errors and
existing background classifications. Distinguish input correction, authentication,
access loss, stale state, in-progress work, contention and uncertain write outcomes.
A lost response never authorizes replay, a success toast or an empty-state fiction.

Evidence: the spec §7 says “A lost response does not justify replay against a new
membership,” but `web/lib/workspace-client.ts:29` unconditionally parses successful
JSON and line 46 collapses remaining failures to “Could not save your changes.
Please try again.” `api/bootstrap/app.php` currently configures JSON rendering but
no shared Problem Details contract. This is a verified integration requirement for
the planned flows, P1, confidence 9/10; no new runtime regression is claimed.
Existing agent-token mint recovery already distinguishes a lost secret response.

Options differed in kind (RFC 9457 versus an application-owned envelope), not
coverage. The chosen contract uses standard HTTP problem semantics with explicitly
application-owned recovery/field-error extensions. The client must tolerate proxy
errors and unknown types; no error format can prove a missing response did not
commit. Current source: [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html).

## Pending decision 7 — durable AI progress versus interrupted-run termination

**P1, confidence 9/10.** Further inspection after recording 6A found that preserving
the existing AI retry policy does not satisfy the stronger planned replay guarantee.
The error review is reopened; 6A remains accepted. This is a source-verified contract
mismatch, not a reproduced production double charge or a new implemented regression.

Motivating requirement: spec §9 says “Retrying a job still rechecks its original
authority and never repeats a completed paid call.” Existing evidence:

- `api/app/Services/AI/AiRunLedger.php:273` claims either `Pending` or `Running`,
  then line 278 returns true whenever the refreshed state is `Running`.
- `api/app/Jobs/GenerateAiRunJob.php:134` executes the generator before recording
  completion; lines 142–152 rethrow transient failures for another queue attempt.
- `api/app/Services/AI/Generators/ReviewDigestGenerator.php:66–73` initializes an
  empty merge and calls every chunk anew. Lines 85–100 record spend but retain the
  merged chunk outputs only in memory until final completion.
- `api/config/queue.php:17–20` explicitly distinguishes dispatch uniqueness from
  redelivery. A correct reservation timeout prevents premature parallel execution;
  it does not prove a killed worker made no paid call before redelivery.

Scenario: chunk one succeeds and is billed; chunk two receives a retryable failure.
A retried job starts at chunk one again. Separately, a worker killed after provider
acceptance but before local completion leaves a running row that can execute again.
The existing exception classifier cannot classify a crash that never reaches it.

**7A (recommended):** persist completed per-call/chunk results with stable run/input
identity and fence in-flight attempts before provider calls; resume only known-safe
remaining work, and stop on an uncertain call outcome. More implementation/storage
and moderate maintenance, but preserves successful work without automatic rebilling.
Input/version/authority changes cannot reinterpret old results as a new operation;
retries still need the original live authority. This is not provider exactly-once.

**7B:** use a durable run-level execution fence and stop an interrupted/partly paid
run for an explicit new request; retain safe pre-call retries but do not resume
completed chunks. Less state/maintenance, with more abandoned partial results and
explicit restarts that may pay again. Both options preserve honest known/unknown
spend, conditional settlement and revocation rules.

Options differ in kind, not coverage—no completeness score. 7A is recommended for
explicit durable state and reliable recovery; the user has already said refactoring
cost should not preserve an inferior design. The actual recovery behavior remains
a new independent decision. Neither remedy has been applied; test planning must
include worker loss before/after provider acceptance and result persistence, chunk
one success plus later transient failure, duplicate delivery and concurrent revoke.

## Architecture checkpoint — complete

Four new findings were resolved through decisions 2A–5A. Full scope remains 1A.
The remaining architecture responsibilities are already stated in the spec:

- **Boundaries/dependencies:** catalogs define actions/roles, live-grant queries
  supply facts, Laravel Policies enter the shared evaluator, and the coordinator
  rechecks authority at protected commits. Route adapters select one surface;
  domain services are reused. The dependency direction is inward from web/REST/
  MCP/share adapters, not from domain services back into HTTP/session selection.
- **State machines:** membership incarnation and assignment revision are distinct;
  invitation token/delivery generation is distinct from offered role revision;
  content operation identity is distinct from its authority. The approved demo
  transition makes the non-member case explicit. Terminal transitions cannot
  resurrect a revoked grant or overwrite a replacement operation.
- **Data flows:** missing target/grant denies; empty authorized collections return
  an empty paginated result; validation errors preserve input; stale and busy
  outcomes do not claim success; external work happens outside locks and fresh
  authorization gates result commits. Diagram below records these paths.
- **Scaling:** at 10x, batch authorization and database pagination avoid one grant
  query per resource. The workspace guard deliberately serializes short commits;
  at 100x concurrency in one workspace, contention/connection pressure is the likely
  bottleneck. Keep bounded waits and measure before changing lock granularity.
  These are architectural estimates, not measured throughput claims; detailed
  performance review remains pending.
- **Failure domains:** the application database is shared by state, grants and
  durable invitation enqueue; its outage refuses mutations. A stopped worker
  delays jobs/mail; independent scheduled cleanup and monitoring detect stalls.
  Private asset storage can fail delivery without permitting a public bypass.
  External mail/AI/source failures cannot widen permissions or roll back unrelated
  committed reviews. Detailed exception/rescue mapping is the next section.
- **Security:** each surface chooses its own grant evidence; no global Owner,
  null-actor or share fallback bypass. Actor privacy, credential bounds and
  resource relationships constrain role actions. Threat-model review is pending.
- **Recovery/distribution:** update matching API/web/worker builds, migrate/restart
  and smoke-test; temporary disruption and manual compatible-build/fix-forward
  recovery are accepted. No new package, binary, container type or authorization
  service needs its own distribution pipeline. Existing application packaging
  remains the distribution boundary; detailed deployment review is pending.

### System boundaries

```plantuml
@startuml
actor Human
actor Agent
actor "Share visitor / participant" as Visitor
actor "Anonymous demo visitor" as Demo
component "Explicit workspace / resource API" as HumanAPI
component "Token-scoped MCP adapter" as MCP
component "Exact-share review adapter" as Shared
component "Demo admission / settled claim" as DemoAPI
component "Explicit authorization context" as Context
component "Policies / resource authorization" as Authz
component "Action + role catalogs" as Catalog
component "Active grant queries / resource predicates" as Grants
component "Domain services / mutation coordinator" as Services
component "Import / scan / AI / mail workers" as Workers
database "Application database + durable invitation queue" as DB
Human --> HumanAPI
Agent --> MCP
Visitor --> Shared
Demo --> DemoAPI
HumanAPI --> Context
MCP --> Context
Shared --> Context
DemoAPI --> Context
Context --> Authz
Authz --> Catalog
Authz --> Grants
Context --> Services
Services --> Authz : Fresh commit checks
Services --> DB
Services --> Workers : Recorded authority + operation identity
Workers --> Services : Conditional result / failure commit
@enduml
```

### Request and background data flow

```plantuml
@startuml
start
:Resolve explicit principal, surface and target;
if (Missing identity or hidden/invalid target?) then (yes)
  :Return safe authentication/not-found result;
  stop
endif
:Resolve live grant and action/resource predicates;
if (Allowed?) then (no)
  :Return forbidden or safe hidden-resource result;
  stop
endif
if (Read?) then (yes)
  :SQL scope before counts/pagination;
  if (Any authorized rows?) then (yes)
    :Return bounded results + safe capabilities;
  else (empty)
    :Return empty page, not an authorization error;
  endif
  stop
endif
:Validate input against the resolved target;
if (Valid?) then (no)
  :Return field errors; preserve input;
  stop
endif
:Coordinator locks / fresh authority and revision checks;
if (Still current within lock budget?) then (no)
  :Return denial / stale conflict / retryable busy;
  stop
endif
:Commit mutation or operation admission;
if (External work required?) then (yes)
  :Execute outside database locks;
  :Recheck exact authority + operation identity;
  if (Still authorized/current?) then (yes)
    :Conditional success/failure settlement;
  else (no)
    :Discard stale result; conditional cleanup only;
  endif
endif
:Return truthful result or queued status;
stop
@enduml
```

These diagrams describe the reviewed contract, not implemented code or passing
application tests. The Section 6 test-coverage diagram remains required and pending.

## Error and rescue checkpoint — in progress

22 failure paths mapped below. **One unresolved recovery gap: decision 7**, found
after the initial 6A map, concerns AI execution after partial success or worker loss.
All implementation and test proof remain pending. This is a plan map, not a claim that all rescues exist today. Named
application conflict/lifecycle/authority failures below are proposed typed domain
outcomes, not an instruction to create a class for every row. Framework and existing
source/AI exception names identify current integration seams.

| Method / codepath | What can go wrong | Exception / outcome | Planned rescue | User sees |
|---|---|---|---|---|
| Action/role resolution | Unknown/wrong-scope role; malformed catalog | Denied decision; configuration `LogicException` | Deny unknowns; fail closed and report invalid definitions | Safe denial or unavailable, no accidental grant |
| Target/authentication resolution | Missing session, hidden target, forbidden action | `AuthenticationException`, `ModelNotFoundException`, `AuthorizationException` | Central 401/404/403 mapping without resource leakage | Sign-in, not found or denied |
| Collections/directory/role inspector | Database failure instead of empty result | `QueryException` | Report; unavailable problem; no empty-list fallback | Retry reading; retained last known state |
| Request validation | Wrong type, bounds, invalid role or target | `ValidationException` | 422 safe field projection after tenant authorization | Correct fields; draft retained |
| Role/remove/move/source mutations | Stale revision, revoked grant, contention | Planned stale/denied outcomes; classified lock `QueryException` | Fresh check; rollback-only bounded retries; 409/403/503 | Refresh or busy; never false success |
| Invitation creation/acceptance uniqueness | Concurrent pending offer or membership activation | `UniqueConstraintViolationException` | Roll back/reload under protected state; reuse offer or conflict, no implicit role overwrite | Current offer or already-member recovery |
| Invitation preview/acceptance | Invalid token, inactive generation, wrong verified recipient, changed role definition | Planned invitation lifecycle outcomes | Uniform invalid response; safe 410/403/409 where recognized | Contact inviter, switch account or refresh |
| Invitation/audit/encrypted enqueue transaction | Queue insertion, encryption or required audit fails | `QueryException`; encryption/serialization exception at queue boundary | Roll back whole mutation; report unexpected failures | Not queued; previous invitation generation remains usable |
| Mail delivery/status commit | Transport refusal, timeout, ambiguous delivery or stale generation | `TransportExceptionInterface`; `QueryException`; obsolete-generation outcome | Bounded same-generation retry; conditional status; never silently rotate | Queued, failed or email may have arrived |
| Session/logout/CSRF | Expired CSRF; failed or uncertain logout; actor changed | `TokenMismatchException`; browser transport failure | Recognized 419 refresh once; confirm logout; stop on actor change | Explicit sign-in/switch-account recovery |
| Exact-share review | Revoked share/participant; wrong nested document | Authorization/not-found outcomes | Recheck exact context at commit; no alternate-share/member fallback | Access unavailable, retained draft |
| MCP read/write adapters | Revoked token or grant; inaccessible target | `AuthenticationException`, `McpToolException` | Safe native MCP errors; report unexpected exceptions | Tool denial/recovery without HTTP-envelope nesting |
| Job admission/result settlement | Lost authority, old incarnation/revision or superseded operation | Planned authority-lost/obsolete-operation outcomes | Terminal conditional settlement/no-op; preserve good content and spend | Cancelled/obsolete current operation; no stale overwrite |
| Import/resync source fetching | Blocked URL, revoked credential, upstream limit/timeout/oversize | `BlockedUrlException`, `TokenRevokedException`, `RateLimitedException`, fetch/import exceptions | Specific bounded classifiers; no public-to-credential fallback | Sanitized source failure or retrying status |
| Tracked-repo scan/file results | Expected file failure versus unexpected database/program error | Explicit recoverable source exceptions; `QueryException`/unexpected exception | Continue only recoverable file cases; stop/report others; atomic report publication | Honest per-file result or failed scan, last good report retained |
| AI start/generate/commit | Dispatch failure, provider timeout/refusal, database failure after paid call | `AiGenerationException`, provider/connection exceptions, `QueryException` | Existing `AiFailureClassifier` is insufficient for crashes/partial replay; **GAP: decision 7** defines durable execution recovery | Safe failed/uncertain result and honest cost status; restart versus resume pending |
| Private image/diagram delivery | Lost reach, missing object or render/storage outage | Authorization outcome; filesystem exceptions; `DiagramRenderException` | Deny or safe unavailable/source panel; never public-origin fallback | Unavailable asset; document remains usable |
| Demo import/claim/prune | Import active, expired demo, competing claim/prune | Planned operation-in-progress/expired/stale outcomes | Ordered locks and terminal claim; generation-conditional callbacks | Wait, explicit retry or unavailable demo |
| Independent abandoned-work cleanup | Database unavailable or operation replaced | `QueryException`; obsolete-operation outcome | Report; retry bounded scan next schedule; settle only current abandoned work | Honest stale/unavailable operational status |
| Optional notification/telemetry | Post-commit transport/observer failure | Specific transport failure; unexpected exception reported at boundary | Preserve committed result; record optional failure safely | Confirmed mutation remains successful |
| HTTP response decoding | Lost response, abort, malformed/unknown/non-JSON response | `TypeError`, `DOMException` (`AbortError`), `SyntaxError`, invalid-shape outcome | Read unavailable; submitted write outcome unknown; reconcile without replay | Retained draft and refresh/recovery, no false toast |
| One-time agent-token result | Created token response lost or secret absent | Transport/invalid-success outcome | Inspect list and revoke orphan if needed; no secret reconstruction | Explicit token recovery instructions |

Catch-all audit: `TrackedRepoScanService::completeScan` currently catches `Throwable`
per file and continues (around line 214); narrowing this was already approved in
the carried project decision 7A. It must not turn authorization loss or programming/
database failures into ordinary file failures. By contrast, the outer AI job catch
feeds `AiFailureClassifier`, whose known categories and conservative unknown handling
are useful existing behavior. Keep a final reporting boundary, not a catch-and-ignore
policy. All new typed outcomes need safe messages and either bounded retry,
conditional terminal settlement, graceful read degradation or contextual rethrow.

```plantuml
@startuml
start
:Resolve actor, target and access surface;
if (HTTP failure classified?) then (yes)
  :Render sanitized Problem Details;
  if (Verified pre-handler CSRF rejection?) then (yes)
    :Refresh once only with unchanged actor/intent;
  else (no)
    :Decode recovery category; preserve draft;
    :Correct, sign in, refresh, wait or stop;
  endif
else (no / missing response)
  if (Write submitted?) then (yes)
    :Outcome unknown;
    :Reconcile permitted current state;
    :Require explicit reviewed resubmission;
  else (no)
    :Read unavailable; allow bounded retry;
  endif
endif
:Never infer success, empty data or retry safety from transport failure;
stop
@enduml
```

### Implementation task from error review

- [ ] **T6 (P1)** — HTTP/client boundary — implement RFC 9457 and truthful recovery.
  - Surfaced by: 6A; fragmented response handling cannot express the approved stale,
    busy and uncertain-write states.
  - Files: `api/bootstrap/app.php`, domain service outcomes, affected API routes,
    `web/lib/csrf-client.ts`, affected workspace/resource/share clients and UI states.
  - Verify: PHPUnit HTTP contract/failure-injection tests plus client decoder tests
    and Playwright lost-response, stale-form and account-change recovery; preserve
    native MCP behavior. Include non-JSON/malformed/unknown problems and valid 204.

## What already exists

| Sub-problem | Existing implementation | Review direction |
|---|---|---|
| Tenancy and membership | Workspace, WorkspaceMember pivot, User workspace relations | Promote to a lifecycle model with active reads and explicit history (2A) |
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
