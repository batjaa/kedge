# Workspace membership — implementation test map

> 2026-09-27 · Required by the [engineering review](workspace-membership-eng-review.md).
> This maps proposed behavior, not implemented features or measured application coverage.

## Harness and evidence

Use PHPUnit (`api/phpunit.xml`, `php artisan test`), existing Vitest (`web/test/`,
`npm test`) and Playwright (`web/e2e/`, `npm run e2e`). No Pest/new framework.
Current PHPUnit defaults use in-memory SQLite and a sync queue; current browser
setup also uses a sync queue. They cannot establish cross-process locking, durable
mail handoff or worker-crash recovery. The required access-integration profile must
use PostgreSQL and file-backed SQLite, real database queue workers and shared
session state. Existing `.github/workflows/ci.yml` is extended, not replaced.

Existing relevant suites include `AuthorizationMatrixTest`, `WorkspaceSettingsTest`,
`AgentTokenWorkspaceScopeTest`, MCP read/write/artifact suites, `LogoutTest`,
`ShareLinkTest`, source/import/scan suites, the six AI endpoint suites, AI classifier/
budget/prompt tests, and the browser share/auth/demo/AI journeys. They establish
useful baseline behavior, not proof of the new roles, lifecycle or call ledger.
Code inspection confirms specific baseline assertions (for example terminal AI
runs create a new run on explicit retry and transient attempts preserve scope);
none of these tests were executed in this planning review. Do not present that
inspection as passing tests or invent a statement-coverage percentage.

Test filenames below are proposed where absent. Implement behavior tests around
public boundaries, with narrow unit tests for catalog/decoder invariants. Shared
fixtures describe four roles, two workspaces, multiple projects plus Unfiled, own/
other authors, exact-share participants, old incarnations and operation generations.
Tests must assert persisted effects, forbidden effects and safe output, not just status.

## Code paths and branches

All `C` groups target ★★★ quality: behavior plus edge and error paths. Branches are
domain-contract branches; final new class/method names are intentionally not frozen.
This table includes the functions and adapters called by each entry point rather
than treating a controller test as proof of its asynchronous dependencies.

| ID / entry and dependent path | Branches that must be proved | Required suite (under `api/tests/` unless stated) |
|---|---|---|
| C01 Catalog → role resolve → Policy decide/capabilities | All matrix actions assigned deliberately; unknown/missing/wrong-scope role/action; duplicate/cyclic dependencies; custom test-provider role constrained to its workspace; definition revision change | New `Unit/Services/Authorization/RoleCatalogTest.php`; extend `Feature/AuthorizationMatrixTest.php` with a matrix-driven endpoint manifest |
| C02 User provisioning → membership lifecycle → active/history queries | One immutable Owner except reserved system workspace; accepted join/revoke/rejoin; identity retained and incarnation/revision advanced; no historical grant via relation/raw consumers; ambiguous migration data fails clearly | New `Feature/WorkspaceMembershipLifecycleTest.php` |
| C03 HTTP/MCP adapter → workspace resolve → validation/scope/service | Personal versus joined workspace; missing/foreign parent; resource-derived target; no ambient selection; old aliases cannot mutate; MCP exact token workspace; `/me` personal identity stable | New `Feature/Api/V1/WorkspaceContextTest.php`; extend `Feature/Mcp/McpReadToolsTest.php` and `AgentTokenWorkspaceScopeTest.php` |
| C04 Invite issue/resend → normalize/ceiling → transaction/audit/encrypted queue | Member default; invalid email/role/revision; duplicate pending request no new send; existing active member conflict; cooldown; accepted slot reused only after removal; enqueue/audit/encryption fault rolls back, preserves old generation | New `Feature/Api/V1/WorkspaceInvitationTest.php`; new `Feature/WorkspaceInvitationDeliveryTest.php` using real DB enqueue |
| C05 Token preview/accept → verified recipient → grant activation | No preview access; uniform invalid; expiry/revoke/replacement; wrong/unverified account; offered definition/inviter invalid; concurrency creates one membership; same acceptance replay only on original active incarnation | New `Feature/Api/V1/WorkspaceInvitationAcceptanceTest.php`; existing auth/reviewer-upgrade suites |
| C06 Member role/remove/leave → expected identity/revision → audit | Every ceiling including Admin versus Admin/self role; Owner protected; matching no-op does not advance revision; stale/ABA role/remove; self-leave; audit failure no mutation; no implicit independent-share revocation | New `Feature/Api/V1/WorkspaceMembersTest.php` |
| C07 Coordinator → ordered guard/grant/resource locks → fresh Policy → commit | Both databases; removal before/after competing write, token revoke, role/source/move ABA; contention deadline and rollback-only retry; original revisions retained; no external replay; failure to remove never reports success | New `Feature/Authorization/WorkspaceMutationConcurrencyTest.php` with process barriers |
| C08 Resource actions → domain services → versions/review persistence | All matrix actions on own/other project/document/thread/comment/suggestion/approval/reaction; former creator Viewer/removed; workflow/version/anchor rules; one active content update; all forks and mentions respect target surface | Extend `Feature/AuthorizationMatrixTest.php` and existing API review/content suites; new `Feature/Api/V1/WorkspaceResourceActionsTest.php` |
| C09 Exact share adapter → participant/context → review service/asset read | Token-only read; exact verified participant; wrong-share/wrong-child denial; no member fallback; revocation before commit; directory/source/private AI hidden; ordinary workspace removal preserves independent share | Extend `Feature/Api/V1/ShareLinkTest.php`; new `Feature/Api/V1/SharedReviewAuthorizationTest.php` |
| C10 Agent mint/list/revoke → incarnation → MCP tool/write coordinator | Human-only creation; Viewer denied creation but self cleanup permitted; same workspace/live role/tool intersection; removal/rejoin never revives token; no REST bearer or MCP cookie bypass; own historical token list only | Extend agent-token REST/scope suites and all `Feature/Mcp/` suites |
| C11 AI start/dedupe → immutable plan → fenced call → checkpoint → publication | Six tools incl. single-call; private versus shared dedupe; original initiator retained; live grant/revision; safe later-chunk retry reuses earlier call; no regeneration on publication retry; input/model/schema fixed; zero calls on empty-input paths where already supported | New `Feature/Ai/AiCallRecoveryTest.php`; extend six `Feature/Api/V1/Ai*Test.php` suites, prompt/classifier/budget tests |
| C12 AI attempts/cleanup → accounting and terminal scrubbing | Kill before fence, after fence/before send, after provider acceptance, after receipt/checkpoint; duplicate workers; proven non-execution versus uncertain 5xx/timeout; receipt counted once; known spend plus unknown total; no late result/content resurrection; all transcript copies scrubbed | New `Feature/Ai/AiCallCrashRecoveryTest.php` with fake provider request counts and real worker processes; extend Ask privacy tests |
| C13 Import/retry/resync jobs → source fetch/project → conditional result | Revoked/changed grant before fetch and before commit; stale operation success/failure/cleanup no-op; last good content preserved; fixed origin/source evidence; correct retry budget; no null-actor bypass | Extend import/resync suites; new `Feature/Import/WorkspaceImportAuthorityTest.php` |
| C14 Source configuration/preview → owner credential check → redirect fetch | Public Member path never picks up stored PAT; Admin denied credential use; Owner allowed; source revision conflict; cross-scheme/host/port redirect blocked before sending; same-origin repository identity; safe provenance/errors | Extend PAT/preview/fetch tests; new `Feature/TrackedRepos/WorkspaceSourceAuthorizationTest.php` |
| C15 Tracked scan → batched retained history → staged results → report publication | Zero matches versus failure; large retained history; branch/path revision; moved/inaccessible resources redacted; only expected file failures continue; stopped worker/revocation; one published generation/page set; prior report retained on failure | Extend `TrackedRepoScanTest.php`, `TrackedRepoRescanTest.php`; new `Feature/TrackedRepos/ScanReportPublicationTest.php` |
| C16 Private asset route → live context/association → backing store | Images/diagrams across member/share/demo; wrong association; revoke during request boundary; no legacy public URL/origin/cache bypass; missing object/render error safe; migration preserves document hash/anchors | New `Feature/Api/V1/PrivateDocumentAssetTest.php`; extend diagram/render suites and deployment route smoke |
| C17 Demo public import → scoped operation → terminal claim/prune | **CRITICAL regression protection:** anonymous import still works without membership; reserved system workspace cannot be joined; active claim 409 unchanged; ready/failed claim; explicit member Retry; expired demo; sorted source/destination locks; late worker/prune no mutation after claim | Extend demo API suites; new `Feature/Import/DemoClaimConcurrencyTest.php` |
| C18 Exceptions → HTTP Problem Details → shared decoder/CSRF | All 6A statuses/types; safe detail/field projection; native MCP unchanged; malformed/non-JSON/unknown responses; valid 204; missing success fields; lost committed write response; no false success/empty state; actor change during refresh stops retry | New `Feature/Api/V1/ProblemDetailsTest.php`; new `web/test/problem-details.test.ts` and `web/test/workspace-recovery.test.ts` |
| C19 Authorized queries → counts/search/pagination/capabilities | Empty/one/10k rows; bounded query growth and memory; explicit useful indexes; no email inference; stable tie-breaker; role/cache freshness; actor/credential/surface/workspace cache separation; inaccessible counts absent | New `Feature/Authorization/WorkspaceQueryScopeTest.php`; extend summary/activity/mentions suites |
| C20 Scheduler cleanup/mail → condition current generation → safe diagnostics | Dead worker and scheduler; stale versus healthy idle; legitimate runtime not reaped; pending mail retries same generation; duplicate uncertain send; no plaintext secret in queue failure/logs; cleanup DB failure visible and later recovery | New `Feature/WorkspaceOperationCleanupTest.php`; delivery tests and CLI smoke |
| C21 Migration/deploy → backfill/settle/restart → smoke | Owner/Member map, stable personal identity, orphan reporting and creator fallback; legacy token validity; unsafe old jobs/AI calls settled, not replayed; reports/assets preserved; interrupted migration reported; matching build recovery | New `Feature/WorkspaceFoundationMigrationTest.php`; ordinary deployment smoke script/runbook |
| C22 Serialization/logging/auth-return → privacy projection | Synthetic invitation token through nested encoded URLs/headers/proxy/errors; no-store/referrer/index headers; admin versus ordinary email projection; private AI actor restriction; checkpoint content absent from HTTP/MCP/logs; GET links cannot grant membership | New `Feature/Authorization/WorkspacePrivacyTest.php`; existing proxy route tests plus browser interception |

## Combined code-path and user-flow coverage diagram

`[GAP]` means the new contract has not been implemented and verified. It does not
mean existing functionality lacks all tests. `→DB` requires the real supported DBs;
`→E2E` means Playwright through the real app; provider calls are controlled fakes,
not live paid experiments. Every line maps to explicit branches above/below.

```text
CODE PATHS (all [GAP], target ★★★)                USER FLOWS (all [GAP], target ★★★)
C01 Catalog -> resolve -> policy/capabilities     F01 Invite -> verify -> accept -> review
    known / unknown / invalid / custom seam          -> downgrade/remove [→E2E]
C02 Provision -> active/history -> rejoin        F02 Wrong/unverified/existing/OAuth account
    Owner / system / revoked / new incarnation       -> return -> explicit accept [→E2E]
C03 Target -> validation -> query/service/MCP    F03 Admin roles -> stale edit/remove -> leave
    own / joined / foreign / removed alias          -> unavailable old workspace [→E2E]
C04 Issue/resend -> audit + encrypted enqueue    F04 Switch workspace/account with open form
    new / duplicate / stale / rollback [→DB]         -> late response/lost response [→E2E]
C05 Preview/accept -> exact verified grant      F05 Resend/replaced link -> expired/revoked
    valid / inactive / wrong / replay [→DB]          -> contact inviter/recovery [→E2E]
C06 Role/remove/leave -> revision -> audit       F06 Member removal -> explicit independent
    ceiling / Owner / no-op / ABA                    Share -> exact-participant review [→E2E]
C07 Coordinator -> locks -> live check -> commit F07 Demo waits -> ready/failed claim -> explicit
    before / after / contention / rollback [→DB]     member Retry / competing prune [→E2E, DB]
C08 Resource services -> review/version writes  F08 AI partial progress -> safe resume OR uncertain
    own / other / Viewer / gone / workflow           stop -> explicit new run [→E2E, DB]
C09 Exact share -> participant -> service
    token-read / wrong child / revoke / no fallback
C10 Token incarnation -> MCP tool -> commit
    live / downgraded / revoked / wrong surface
C11 AI plan -> fence -> call -> checkpoint -> publish
    completed reuse / safe retry / denied [→DB]
C12 Crash/duplicate -> uncertain OR saved progress
    accounting once / scrub / no resurrection [→DB]
C13 Import -> fetch -> guarded success/failure
    current / revoked / obsolete / failed [→DB]
C14 Source -> credentials -> redirect/fetch
    public / Owner / unauthorized / wrong origin
C15 Scan -> bounded stage -> atomic report
    empty / file error / unexpected / obsolete [→DB]
C16 Asset -> live reach -> private backing store
    member/share/demo / hidden / storage error
C17 Demo -> public operation -> settled claim
    active / ready / failed / expired / race [→DB]
C18 HTTP failure -> decode -> recovery
    valid / malformed / lost / actor changed
C19 Query -> bounded page/count/capabilities
    zero / one / large / hidden / context mismatch
C20 Cleanup/mail -> conditional settlement -> diagnostics
    current / replaced / dead / unavailable [→DB]
C21 Migration -> backfill -> settle -> deploy smoke
    valid / orphan / unsafe legacy / interrupted
C22 Project safe fields -> redact nested secret paths
    self/admin/member/share / error / token URL
```

Contract-group verification: **0/30 certified for the new foundation** (22 code
contracts + eight journeys). All 30 have required implementation tests; existing
suites are reuse points, not certification. Target quality: 30 ★★★ groups. No
measured line/branch coverage claim. Keep endpoint/action manifest completeness
checks so new routes/actions cannot silently fall outside C01/C08/C10.

The plan changes execution/authorization, not intended model output semantics.
No new model-quality eval is required. Preserve existing prompt snapshots/fence
and assembly tests; add equivalence assertions for checkpointed inputs. A later
prompt/tool-instruction change would require its own output-quality evaluation.

## Browser journeys and recovery assertions

| Flow | Proposed/extended file under `web/e2e/` | Assertions beyond happy path |
|---|---|---|
| F01 Invite → accept → review → remove | New `workspace-membership.spec.ts` | New and existing verified user; all-projects/Unfiled disclosure; Member default; correct workspace; actual review write; downgrade hides controls and server denies old request; removal preserves attribution |
| F02 Account recovery | Extend `account-recovery.spec.ts`, `auth-edges.spec.ts`, `reviewer-magic-link.spec.ts` | Exact invitation recipient, unverified existing account, Reviewer upgrade, OAuth return; real concurrent logout/session request; no automatic accept on GET or after login |
| F03 Administration | New `workspace-members.spec.ts` | Admin role ceilings and Owner protection; stale form/rejoin; lost successful removal response; denied-current-state copy; keyboard confirmation, focus, narrow layout |
| F04 Context/recovery | New `workspace-context.spec.ts` | Two tabs/workspaces; switching from settings/project/document always opens destination home; selecting current is a no-op; late read after switch; old form stays targeted; malformed proxy response; actor changes during CSRF refresh; no replay, wrong-workspace toast or success fiction |
| F05 Invitation states | New `workspace-invitations.spec.ts` | Cooldown, duplicate pending, delivery failure/uncertainty, resend invalidates link; expired/revoked offer no disclosure; accepted-then-removed recipient gets a fresh invitation |
| F06 Independent share | Extend `share-lifecycle.spec.ts` | Removal warning accurate; share still works deliberately; exact participant on correct share; wrong child/old implicit route denied; private asset authorization |
| F07 Demo claim | Extend `m1-demo.spec.ts` | **CRITICAL regression protection:** real worker paused while claim disabled; active server claim rejected; ready/failed claim; explicit failed-import Retry; no late anonymous callback in workspace |
| F08 AI recovery | Extend `ai-triage.spec.ts`, `ai-ask.spec.ts` | Saved partial progress resumes without repeated provider calls; uncertain outcome explains potential cost and requires new click; removed actor cannot see private saved content; transcript copies scrub on terminal state |

## Failure-modes registry

All rows below require tests; **none is claimed implemented/tested for this new
contract**. Planned handling is explicit, so there is no unacknowledged silent-failure
row. Logging means safe correlation/counters, never payloads/tokens. Denials may use
bounded structured counters rather than a verbose log for every normal rejection.

| Codepath | Realistic failure | Rescue planned? | Test required | User sees | Safe diagnostic |
|---|---|---|---|---|---|
| C01 | New action accidentally inherits power | Yes: explicit deny/validation | C01 | Denied/unavailable | Definition error ID |
| C02 | Revoked retained row grants access | Yes: active/history separation | C02 | Access removed | Membership revision |
| C03 | Joined form uses personal workspace | Yes: one explicit context | C03/F04 | Correct target or denial | Workspace/action IDs |
| C04 | Queue insert fails after offer rotation | Yes: atomic rollback | C04/F05 | Not queued, old offer retained | Delivery generation/failure |
| C05 | Two accept requests activate different grants | Yes: serialized transition | C05/F01 | Same active acceptance or conflict | Grant/incarnation |
| C06 | Old remove form targets rejoined member | Yes: expected revision | C06/F03 | Refresh required | Stale outcome |
| C07 | Removal races an authorized write | Yes: ordered commit | C07 | One truthful ordering | Wait/commit duration |
| C08 | Former creator retains edit power | Yes: live role plus resource predicate | C08/F01 | Denied, draft retained | Safe denial code |
| C09 | Participant of another share writes | Yes: exact context | C09/F06 | Denied without fallback | Surface/action |
| C10 | Rejoin revives old token | Yes: incarnation binding | C10 | Native MCP rejection | Token ID, never secret |
| C11 | Later chunk retry rebills first chunk | Yes: checkpoint reuse | C11/F08 | Safe resumed progress | Call/attempt IDs |
| C12 | Worker dies after provider accepts | Yes: uncertain stop/accounting | C12/F08 | Interrupted, cost may be unknown | Fence/deadline/recovery |
| C13 | Late job overwrites replacement content | Yes: operation guard | C13 | Current good content retained | Obsolete callback counter |
| C14 | Redirect leaks PAT | Yes: pre-request origin check | C14 | Safe source failure | Redacted origin reason |
| C15 | Database bug treated as a skipped file | Yes: narrow classification | C15 | Scan failed, prior report retained | Correlated unexpected error |
| C16 | Public cache survives removal | Yes: close bypasses/live route | C16/F06 | Asset denied/unavailable | Safe asset route/status |
| C17 | Claim races prune/import | Yes: ordered locks/terminal handoff | C17/F07 | Claim succeeds once or fails safely | Claim/operation identity |
| C18 | Committed write loses response | Yes: outcome-unknown recovery | C18/F04 | Refresh/reconcile, no auto replay | Request ID if received |
| C19 | Hidden email matches directory search | Yes: scoped fields/query | C19 | Only permitted matches/totals | Bounded query metrics |
| C20 | Scheduler stops silently | Yes: independent heartbeat check | C20 | Operator stale/unavailable alert | Last successful check age |
| C21 | Legacy job resumes without authority evidence | Yes: settle and explicit restart | C21 | Interrupted operation | Migration/recovery counts |
| C22 | Token nested in auth-return error gets logged | Yes: redaction before capture | C22 | Safe error | Secret-free route/status |

## Required verification procedure

1. Fast PHPUnit/Vitest tests cover deterministic decisions, endpoint behavior and
   decoder/prompt contracts; keep real external providers disabled.
2. The dedicated access-integration check starts separate processes on PostgreSQL
   and file-backed SQLite. Use barriers at preflight, lock acquisition, provider
   receipt and pre-commit; assert ordering and state, not race-prone sleeps.
3. Use a controllable fake provider/mail transport that records calls across workers,
   can acknowledge then drop a response, and can force process death at boundaries.
   A mock exception in one process is insufficient for durable recovery proof.
4. Run F01–F08 with real database workers/shared state where required, isolation per
   scenario, bounded startup/teardown and no secret-bearing traces. Missing required
   prerequisites or skipped required scenarios fail the profile.
5. Deployment smoke proves real mail receipt, worker/scheduler execution, both app
   surfaces and private-origin closure. This is ordinary release verification, not
   a maintenance/cutover gate. Record any external smoke not run as outstanding.

Keep existing supported Laravel/Node runtimes and repository check commands. Add the
new integration profile's exact command to repo documentation when implemented;
there is no executable profile or passing application-test result in this review.
