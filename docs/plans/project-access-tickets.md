# Project access — proposed ticket breakdown

> 2026-09-27 · Draft for granularity/dependency approval; not published.
> Module parent: **Project access: invitations and project roles (M4.1)**.
> Tracker: GitHub, native sub-issues and dependencies plus canonical Blocked by lines.
> Spec: [M4.1](../specs/m4.1-project-access.md) · [Roadmap](../ROADMAP.md).

The user resumed engineering review before approving or publishing this draft.
Decisions 1A–20A are now accepted; performance is complete as a planning
checkpoint and later review sections remain unfinished. Ticket publishing is on hold. Reconcile this breakdown after review,
including whether proposed T01 is still needed; do not start its proposed frontier
as a substitute for completing the review.

Numbers below are draft IDs, not GitHub issue numbers. Upon approval, create one
module parent, then these children in order, using real identifiers for both native
dependencies and each issue’s Blocked by section. No existing project-access module
or child issues were found. Existing [#156](https://github.com/batjaa/kedge/issues/156)
is a separate verification-recovery bug and blocks release, not unrelated refactors.

## Rules shared by implementation tickets

Every slice is complete through its relevant user flow, API/service/persistence
and verification layers; no separate “schema only”, “API only” or “UI only” tickets.
T02/T04 are deliberate prefactors demonstrated through existing endpoints; T03
is a verifiable integration-harness slice. UI work includes the existing design
language, four locales, both themes, keyboard/mobile and explicit recovery states.
Each behavior-changing slice carries its own authorization/denial, regression,
audit and failure tests; T25 verifies the whole boundary rather than supplying
missing tests for earlier work. Use the accepted test map and 17A profile.

New invitation/project grants remain behind the agreed rollout control throughout
implementation. Fixture-enabled demos may show a completed slice, but unintegrated
project-only mutations fail closed and public enablement waits for T25. Existing
independent workspace/Share grants retain their specified behavior. Maintain the
workspace expansion seam without adding workspace invitation UI or a generic ACL.
18A requires bounded-page grant reads and response-only reuse, with fresh write/job
authority; incorporate it in the access and read-projection slices.

## Dependency overview

1. **Resolve remaining engineering and design decisions** — **Blocked by:** None — can start immediately. **Delivers:** Finish the remaining project-access review and make the implementation and rollout choices explicit.
2. **Consolidate AI generation starts** — **Blocked by:** None — can start immediately. **Delivers:** Digest, Improve-the-doc Prompt and Split Proposal requests use the same start/join and failure behavior already used by Ask and thread AI.
3. **Add the required database-and-worker integration profile** — **Blocked by:** None — can start immediately. **Delivers:** A required CI check and a matching local command run real queue and concurrency tests without replacing the existing fast suites.
4. **Introduce the shared transaction boundary through comment writes** — **Blocked by:** T03. **Delivers:** Existing comment and reply writes demonstrate one reusable transaction boundary for live authorization and resource placement.
5. **Make shared sign-out reliable for account switching** — **Blocked by:** T03. **Delivers:** Ordinary sign-out confirms that the old account is gone and supports reliable return to an internal destination.
6. **Keep repository credentials within their original origin** — **Blocked by:** None — can start immediately. **Delivers:** Authenticated source discovery and document fetches refuse redirects that would expose credentials.
7. **Serve imported images through document-authorized delivery** — **Blocked by:** T03. **Delivers:** Images remain readable through valid document, Share or Demo Document access, while copied storage URLs no longer bypass access checks.
8. **Protect cached diagrams and complete legacy media migration** — **Blocked by:** T07. **Delivers:** Diagrams use the same document-authorized delivery boundary, including existing cached assets.
9. **Send a project invitation and show its safe preview** — **Blocked by:** T01, T04. **Delivers:** The workspace owner can invite a named recipient from Members, see delivery status, and send a link that reveals only the permitted preview.
10. **Resend and revoke pending invitations safely** — **Blocked by:** T09. **Delivers:** The owner can recover delivery, replace an old invitation link or revoke a pending offer from Members.
11. **Accept an invitation and discover the shared project** — **Blocked by:** T05, T08, T10. **Delivers:** A matching verified account explicitly joins and finds the project under Shared with you, with safe read-only access and no sibling-workspace disclosure.
12. **Manage project members, roles and voluntary leaving** — **Blocked by:** T11. **Delivers:** Members shows effective access and lets authorized people invite, change roles, remove others or leave their own direct membership.
13. **Enable role-aware commenting, own-thread actions and mentions** — **Blocked by:** T12. **Delivers:** Project Reviewers and Maintainers can discuss documents and manage their own contributions, while Viewers remain read-only.
14. **Enable version-pinned approvals and suggestion decisions** — **Blocked by:** T12. **Delivers:** Project Reviewers approve under their own identity, and Maintainers decide proposed suggestions without impersonating another reviewer.
15. **Enable Maintainer project and review moderation** — **Blocked by:** T12. **Delivers:** Maintainers can edit project details, change document lifecycle and moderate threads without rewriting others’ contributions.
16. **Manage document Shares and move documents between project audiences** — **Blocked by:** T12. **Delivers:** Maintainers can manage project-document Shares and move a document between projects they maintain, with its complete review history.
17. **Import public and pasted documents as a Maintainer** — **Blocked by:** T06, T12. **Delivers:** Maintainers add documents to the invited project using pasted/uploaded content or credential-free public sources.
18. **Re-sync documents with current source authority** — **Blocked by:** T17. **Delivers:** Maintainers refresh an accessible source while preserving Document identity, review anchors and the last good version on failure.
19. **Replace pasted content without losing a competing editor’s draft** — **Blocked by:** T18. **Delivers:** A Maintainer can submit a new version of pasted content; a competing editor receives a clear busy state and keeps their draft.
20. **Approve private repositories and delegate file import and re-sync** — **Blocked by:** T18. **Delivers:** The owner approves a repository for a project, then a Maintainer can import or refresh its files without accessing workspace credentials.
21. **Add and scan Tracked Repos with delegated project access** — **Blocked by:** T20. **Delivers:** Maintainers attach approved private or public Tracked Repos, preview matches, scan them and read a report limited to their current audience.
22. **Change tracked branches and path filters without losing document identity** — **Blocked by:** T21. **Delivers:** Maintainers change a Tracked Repo’s selected branch or paths while existing documents keep their identity and review history.
23. **Enable role-aware AI tools and private artifacts** — **Blocked by:** T02, T12. **Delivers:** Reviewers use Ask and reply drafts, Maintainers use all existing AI tools, and Viewers read only shared artifacts.
24. **Recover revoked or abandoned project operations without a browser visit** — **Blocked by:** T21, T23. **Delivers:** The scheduler settles stranded imports, re-syncs, scans and AI Runs safely so users do not return to permanent pending states.
25. **Verify the complete access boundary and enable invitations** — **Blocked by:** T13, T14, T15, T16, T19, T22, T24, #156. **Delivers:** The complete project-access experience is ready to enable in both editions, with verified migration, recovery and operational behavior.

## Draft issue bodies

The Spec line below is the only source-path reference needed in published bodies.
The shared implementation rules above accompany each applicable published child.

## T01 — Resolve remaining engineering and design decisions

### Spec

docs/specs/m4.1-project-access.md

### What to build

Finish the remaining project-access review and make the implementation and rollout choices explicit.

### Acceptance criteria

- [ ] Finish performance, observability, deployment, long-term and UX review; issue 18 is resolved as 18A. This proposed review ticket may be removed once the interactive review finishes.
- [ ] Complete the design review for invitations, Members, Shared with you, role changes, source approval and access-loss states using the existing design language.
- [ ] Record chosen query/lock budgets, operational signals, migration/rollback sequence, rollout controls and any changed dependencies; reconcile later ticket criteria before implementation.
- [ ] Keep accepted decisions 1A–20A unless the user explicitly revises them; do not silently reduce scope.

### Blocked by

Blocked by: None — can start immediately

## T02 — Consolidate AI generation starts

### Spec

docs/specs/m4.1-project-access.md

### What to build

Digest, Improve-the-doc Prompt and Split Proposal requests use the same start/join and failure behavior already used by Ask and thread AI.

### Acceptance criteria

- [ ] Pin the six run types through endpoint regression tests, then consolidate duplicate orchestration into the existing shared service; refactor as necessary.
- [ ] Preserve input checks, readiness/version checks, response statuses, actor/target/variant deduplication, Ask exemption and per-actor privacy.
- [ ] Joining a run dispatches nothing and preserves its original initiating authority; preserve cost, timeout, terminal-state and explicit retry behavior.
- [ ] Use scripted providers; introduce no generic AI framework or unrelated frontend cleanup.

### Blocked by

Blocked by: None — can start immediately

## T03 — Add the required database-and-worker integration profile

### Spec

docs/specs/m4.1-project-access.md

### What to build

A required CI check and a matching local command run real queue and concurrency tests without replacing the existing fast suites.

### Acceptance criteria

- [ ] Run independent-connection contracts on PostgreSQL and file-backed SQLite, with committed isolated fixtures and controlled overlap.
- [ ] Boot an asynchronous database worker and shared cache for affected browser journeys; prove readiness with an existing queued-mail flow and database transaction checks.
- [ ] Fail on unavailable engines/workers, incompatible queue settings, empty required test selection or skipped required checks; isolate and clean up processes.
- [ ] Retain safe failure logs/traces and configure the profile as a required merge/release check; later slices add their contracts to this same profile.

### Blocked by

Blocked by: None — can start immediately

## T04 — Introduce the shared transaction boundary through comment writes

### Spec

docs/specs/m4.1-project-access.md

### What to build

Existing comment and reply writes demonstrate one reusable transaction boundary for live authorization and resource placement.

### Acceptance criteria

- [ ] Reuse Policies as permission rules; coordinate deterministic project/document locking, live authorization and the write in the same short transaction.
- [ ] Integrate existing comment/reply transactions and MCP revocation guards without conflicting lock order; keep external work outside locks.
- [ ] Preserve existing endpoint behavior while establishing the reusable boundary; later slices adopt it for their own domain operations.
- [ ] Prove rollback, changed placement/authority and MCP revoke/write ordering on both supported databases.

### Blocked by

Blocked by: T03

## T05 — Make shared sign-out reliable for account switching

### Spec

docs/specs/m4.1-project-access.md

### What to build

Ordinary sign-out confirms that the old account is gone and supports reliable return to an internal destination.

### Acceptance criteria

- [ ] Reproduce the documented concurrent-session race on the current driver and implement the smallest proven server fix, including session rotation and remember-me.
- [ ] The shared client checks final success, handles failed/uncertain outcomes and exhausted CSRF recovery, and offers retry while retaining the internal destination.
- [ ] Controlled concurrent requests cannot restore the old identity after confirmed logout; use no network-idle workaround as evidence.
- [ ] Keep ordinary sign-out and invitation switching on one flow; this does not replace verified-recipient checks.

### Blocked by

Blocked by: T03

## T06 — Keep repository credentials within their original origin

### Spec

docs/specs/m4.1-project-access.md

### What to build

Authenticated source discovery and document fetches refuse redirects that would expose credentials.

### Acceptance criteria

- [ ] Reject changed scheme, host or effective port before contacting the redirect target, including later hops in a chain.
- [ ] Keep credential-free public redirects and the existing SSRF, DNS pinning, timeout and size defenses.
- [ ] Exercise discovery and file-fetch entry points with controlled transports and prove rejected destinations receive no request or credential.
- [ ] Preserve clear source-error recovery; repository approval identity checks are added by T20.

### Blocked by

Blocked by: None — can start immediately

## T07 — Serve imported images through document-authorized delivery

### Spec

docs/specs/m4.1-project-access.md

### What to build

Images remain readable through valid document, Share or Demo Document access, while copied storage URLs no longer bypass access checks.

### Acceptance criteria

- [ ] Use private backing storage and check current document/version reach plus asset association on each new request; retain safe image/SVG embedding.
- [ ] Adapt existing image references without changing Document Version hashes or anchors; close local/public-origin/cache bypasses during the documented cutover.
- [ ] Preserve independent Share and demo behavior and safe missing/storage-failure states; old delivered bytes cannot be recalled.
- [ ] Keep storage lookup separate from authorized delivery, with local-storage tests and deployed object-store checks; do not implement temporary-URL mode.

### Blocked by

Blocked by: T03

## T08 — Protect cached diagrams and complete legacy media migration

### Spec

docs/specs/m4.1-project-access.md

### What to build

Diagrams use the same document-authorized delivery boundary, including existing cached assets.

### Acceptance criteria

- [ ] Bind diagram delivery to document/version access even when rendering is deduplicated by source hash; a known hash grants no access.
- [ ] Preserve Kroki allowlisting, safe SVG embedding, caching, source-error fallback and valid Share/demo rendering.
- [ ] Complete legacy diagram-reference and private-storage migration without changing historical versions or anchors; verify no old public URL or cache route bypasses checks.
- [ ] Provide repeatable migration verification and recovery instructions for both deployment modes; include browser image/diagram journeys.

### Blocked by

Blocked by: T07

## T09 — Send a project invitation and show its safe preview

### Spec

docs/specs/m4.1-project-access.md

### What to build

The workspace owner can invite a named recipient from Members, see delivery status, and send a link that reveals only the permitted preview.

### Acceptance criteria

- [ ] Provide paginated pending invitations, three grantable roles with Reviewer default, normalized email validation, duplicate/member conflict handling and inherited owner identity.
- [ ] Persist the invitation generation, required audit and encrypted delivery job atomically on the same database connection; reject incompatible configuration.
- [ ] Use seven-day tokens, bounded same-generation retries and honest uncertain-delivery status; rollback/crash tests prove no stranded queued invitation.
- [ ] Preview GET grants no membership/session/verification; cover token redaction in nested auth destinations, logs and headers plus no-store/no-referrer/noindex, including errors.
- [ ] Keep invitation entry points behind the agreed rollout control until T25; demonstrate using controlled mail and actual links.

### Blocked by

Blocked by: T01, T04

## T10 — Resend and revoke pending invitations safely

### Spec

docs/specs/m4.1-project-access.md

### What to build

The owner can recover delivery, replace an old invitation link or revoke a pending offer from Members.

### Acceptance criteria

- [ ] Resend rotates token/generation and starts a fresh seven days; enforce cooldown/throttles and retain the previous generation if the transaction fails.
- [ ] Require target identity/revision; stale controls conflict, refresh permitted state and require explicit retry without duplicate sends.
- [ ] Revoked, expired and replaced links show the specified recovery states; old workers cannot send or overwrite the current generation.
- [ ] Invalidating inviter authority permanently invalidates its pending offers; later restoration never revives them; expose the service hook for membership changes.

### Blocked by

Blocked by: T09

## T11 — Accept an invitation and discover the shared project

### Spec

docs/specs/m4.1-project-access.md

### What to build

A matching verified account explicitly joins and finds the project under Shared with you, with safe read-only access and no sibling-workspace disclosure.

### Acceptance criteria

- [ ] Add Project Member identity/role/grant revision with required uniqueness and scope integrity; atomically accept once, handle replay and never regrant after removal.
- [ ] Preserve invitation destination through password signup/sign-in, mailbox confirmation, supported OAuth and reviewer upgrade; wrong-account recovery uses shared sign-out.
- [ ] Provide paginated Shared with you, direct project/roster reads, safe source grouping, documents/versions/discussions and shared-artifact reads through Policies and scoped queries.
- [ ] Keep personal-workspace home/settings and MCP scope unchanged; deny all not-yet-integrated direct-project mutations until their slices land, even for persisted higher roles.
- [ ] Read real test-mail links in browser journeys; include asset access, foreign/nested-ID denial and role/field minimization.

### Blocked by

Blocked by: T05, T08, T10

## T12 — Manage project members, roles and voluntary leaving

### Spec

docs/specs/m4.1-project-access.md

### What to build

Members shows effective access and lets authorized people invite, change roles, remove others or leave their own direct membership.

### Acceptance criteria

- [ ] Maintainers manage Viewer/Reviewer seats and invitations; only the workspace owner manages Maintainers; inherited owner access cannot be removed here.
- [ ] Compare target identity/revision atomically, including removal/reinvite; stale actions have no effects and require explicit retry after refresh.
- [ ] Removal/downgrade invalidates the direct grant and pending offers immediately while preserving contributions and independent workspace/Share access.
- [ ] Show access-removed and remaining-grant explanations; preserve creation/escalation audit atomicity and successful reduction if audit reporting fails.
- [ ] Prove membership mutation versus protected write ordering and old invitation replay; new capability consumers join the same boundary.

### Blocked by

Blocked by: T11

## T13 — Enable role-aware commenting, own-thread actions and mentions

### Spec

docs/specs/m4.1-project-access.md

### What to build

Project Reviewers and Maintainers can discuss documents and manage their own contributions, while Viewers remain read-only.

### Acceptance criteria

- [ ] Cover comments/replies/reactions, own edits/deletes and own-thread resolve/reopen/fork/reattach through API and UI capabilities.
- [ ] Authorship alone never grants access after removal, move to another project/Unfiled, or downgrade; share-reviewer behavior retains its separate valid grant.
- [ ] Mention suggestions and new mention validation stay within the visible audience; preserve historical attribution without granting directory access.
- [ ] Apply the coordinator to writes, preserve comment persistence despite notification failure, and test stale UI, nested IDs, concurrent removal and both grant types.

### Blocked by

Blocked by: T12

## T14 — Enable version-pinned approvals and suggestion decisions

### Spec

docs/specs/m4.1-project-access.md

### What to build

Project Reviewers approve under their own identity, and Maintainers decide proposed suggestions without impersonating another reviewer.

### Acceptance criteria

- [ ] Allow own version-pinned sign-off/revocation to eligible roles; forbid signing or revoking on someone else’s behalf, including for the owner.
- [ ] Allow Maintainer suggestion decisions under the live role while preserving existing version and anchor validation.
- [ ] Apply Policies/coordinator/capabilities consistently, including missing grant, downgrade, document move and stale version outcomes.
- [ ] Preserve attribution and history, and demonstrate role-specific controls plus removal/write concurrency through existing review UI.

### Blocked by

Blocked by: T12

## T15 — Enable Maintainer project and review moderation

### Spec

docs/specs/m4.1-project-access.md

### What to build

Maintainers can edit project details, change document lifecycle and moderate threads without rewriting others’ contributions.

### Acceptance criteria

- [ ] Provide permitted rename/description/lifecycle controls and any-thread resolve/reopen/fork/reattach plus deletion of inappropriate comments.
- [ ] Nobody rewrites another author’s text; lifecycle changes manufacture no sign-offs; preserve Reviewer own-contribution rules and Viewer read-only access.
- [ ] Use live Policies/coordinator and bounded validated inputs; invalidation and source/placement changes cannot preserve stale mutation authority.
- [ ] Pin UI, API denial and concurrency behavior with audit attribution and recovery states.

### Blocked by

Blocked by: T12

## T16 — Manage document Shares and move documents between project audiences

### Spec

docs/specs/m4.1-project-access.md

### What to build

Maintainers can manage project-document Shares and move a document between projects they maintain, with its complete review history.

### Acceptance criteria

- [ ] Allow create/list/revoke of document Shares regardless of issuer; deny Viewer/Reviewer administration; membership removal does not silently revoke independent Shares.
- [ ] Moves require both-end Maintainer access and same workspace; only the owner moves to/from Unfiled; show destination audience before confirmation.
- [ ] Compare placement revision including away/back, reauthorize both ends and serialize with writes; preserve versions, approvals, provenance and independent Shares.
- [ ] Prove old-project and asset access ends while valid alternative grants remain; moved tracked documents cannot be duplicated or reassigned by future scans.

### Blocked by

Blocked by: T12

## T17 — Import public and pasted documents as a Maintainer

### Spec

docs/specs/m4.1-project-access.md

### What to build

Maintainers add documents to the invited project using pasted/uploaded content or credential-free public sources.

### Acceptance criteria

- [ ] Resolve workspace from the authorized project rather than client input; preserve omitted-project personal-workspace behavior and deny Viewer/Reviewer import.
- [ ] Record initiating grant and operation generation, recheck before external work/commit, and block old success/failure/cleanup from overwriting replacement work.
- [ ] Public imports never fall back to workspace credentials; preserve safe rendering, guarded fetch, image normalization and explicit failure/retry UI.
- [ ] Prove removal/reinvite and document/source movement invalidate old delegated work; preserve last good data where applicable and accurate audit attribution.

### Blocked by

Blocked by: T06, T12

## T18 — Re-sync documents with current source authority

### Spec

docs/specs/m4.1-project-access.md

### What to build

Maintainers refresh an accessible source while preserving Document identity, review anchors and the last good version on failure.

### Acceptance criteria

- [ ] Carry initiating authority and operation generation through fetch, projection, re-anchoring and conditional commit/cleanup.
- [ ] Prevent revoked, moved or superseded work from committing; private-source refresh remains denied until a destination Repository Approval exists.
- [ ] Preserve version deduplication, candidate lineage, approval staleness, explicit retries and honest operation status; polling timeout is not completion.
- [ ] Exercise late old-worker cleanup after replacement success and both database concurrency paths.

### Blocked by

Blocked by: T17

## T19 — Replace pasted content without losing a competing editor’s draft

### Spec

docs/specs/m4.1-project-access.md

### What to build

A Maintainer can submit a new version of pasted content; a competing editor receives a clear busy state and keeps their draft.

### Acceptance criteria

- [ ] Atomically admit one pending/running content update before modifying stored input; return 409 for a competitor without changing body, actor or generation.
- [ ] Keep the accepted operation’s input/attribution through retries and terminal writes; queue uniqueness alone is not admission control.
- [ ] Retain the rejected draft, refresh after settlement and require explicit retry; do not add a backlog or report timeout as unchanged-content success.
- [ ] Use real worker barriers before start and after input read, plus a two-Maintainer browser journey, to prove no silent loss.

### Blocked by

Blocked by: T18

## T20 — Approve private repositories and delegate file import and re-sync

### Spec

docs/specs/m4.1-project-access.md

### What to build

The owner approves a repository for a project, then a Maintainer can import or refresh its files without accessing workspace credentials.

### Acceptance criteria

- [ ] Provide owner-only Repository Approval administration and a Maintainer picker; existing connected repositories receive no automatic delegation.
- [ ] Bind repository ID, GitHub owner ID and selected Integration; allow matching-ID rename, reject old-name replacement and require owner reapproval after transfer.
- [ ] Enforce approval/project identity before credential use and again before commit; revocation, replacement, moves and transfer-back never revive old queued authority.
- [ ] Use stale-target checks for administration and preserve imported content/history; show owner recovery rather than perpetual retry or secret-bearing errors.
- [ ] Apply credential-origin protection to discovery and fetch; integration substitution requires owner action.

### Blocked by

Blocked by: T18

## T21 — Add and scan Tracked Repos with delegated project access

### Spec

docs/specs/m4.1-project-access.md

### What to build

Maintainers attach approved private or public Tracked Repos, preview matches, scan them and read a report limited to their current audience.

### Acceptance criteria

- [ ] Authorize public credential-free and approved private preview/add/scan/untrack actions; keep Viewer/Reviewer source grouping safe without exposing configuration.
- [ ] Carry scan/configuration/operation and initiating grant identities into descendant imports/re-syncs; revalidate current document placement at each protected boundary.
- [ ] Continue only explicitly recoverable file failures; stop/report authority, database and programming failures while preserving earlier valid commits.
- [ ] Skip inaccessible moved documents without exposing paths/counts, duplicating imports or reassigning them; untracking retains documents and reviews.
- [ ] Prove empty repository versus no matches, partial failure, removal during scan and obsolete report/cleanup protection.

### Blocked by

Blocked by: T20

## T22 — Change tracked branches and path filters without losing document identity

### Spec

docs/specs/m4.1-project-access.md

### What to build

Maintainers change a Tracked Repo’s selected branch or paths while existing documents keep their identity and review history.

### Acceptance criteria

- [ ] Validate through preview and compare target/configuration revision; reject edits while a scan is pending/running.
- [ ] Discovery, descendant fetches and later manual re-sync follow the selected branch for existing repository/path identities.
- [ ] Update source binding even if initial content is identical; retain missing/excluded content and normal version/anchor/approval behavior.
- [ ] Never move documents, expose inaccessible paths or duplicate them as a side effect; repository identity changes use explicit remove/add approval rules.

### Blocked by

Blocked by: T21

## T23 — Enable role-aware AI tools and private artifacts

### Spec

docs/specs/m4.1-project-access.md

### What to build

Reviewers use Ask and reply drafts, Maintainers use all existing AI tools, and Viewers read only shared artifacts.

### Acceptance criteria

- [ ] Apply per-run-type Policies and UI controls through consolidated starts; keep workspace provider/rate gates and user cost attribution.
- [ ] Carry original initiating grant into new runs, never replace it on join; recheck before outbound work and conditional output commit.
- [ ] Preserve per-actor Ask/reply privacy, shared artifact reads and human-confirmed drafts; generating output grants no permission to apply it.
- [ ] Downgrade/removal suppresses forbidden results while preserving incurred spend and terminal-state guarantees; project access grants no new MCP scope.

### Blocked by

Blocked by: T02, T12

## T24 — Recover revoked or abandoned project operations without a browser visit

### Spec

docs/specs/m4.1-project-access.md

### What to build

The scheduler settles stranded imports, re-syncs, scans and AI Runs safely so users do not return to permanent pending states.

### Acceptance criteria

- [ ] Use bounded database batches and generation-conditional terminal writes independent of the work queue; legitimate queue/runtime/retry budgets are respected.
- [ ] Preserve last good content and AI spend; never automatically restart imports or paid generation.
- [ ] Repeated cleanup and races with replacement work are harmless; database/scheduler outage has explicit diagnostics and recoverable operation.
- [ ] Demonstrate no-browser recovery and scheduler operation in both deployment modes using required real-database tests.

### Blocked by

Blocked by: T21, T23

## T25 — Verify the complete access boundary and enable invitations

### Spec

docs/specs/m4.1-project-access.md

### What to build

The complete project-access experience is ready to enable in both editions, with verified migration, recovery and operational behavior.

### Acceptance criteria

- [ ] Execute every accepted capability and coverage-map contract, including all grant combinations, current/legacy media, real-mail accept/remove and unchanged MCP refusal.
- [ ] Apply the reviewed additive migration/API-before-web sequence and rollback plan; no partially protected invitations become available between slices.
- [ ] Finish the operational signals, request/lock/query measurements and deployment checks decided by T01; scheduler, queue and private storage/cache configuration are verified.
- [ ] Complete keyboard/mobile/both-theme/four-locale journeys on Kedge’s actual documentation project and validate mixed-version clients fail closed.
- [ ] Ensure existing verification-recovery issue #156 is resolved before release; record concrete release evidence and enable the agreed invitation control only after every required gate passes.

### Blocked by

Blocked by: T13, T14, T15, T16, T19, T22, T24, #156

## Frontier and decision coverage

Proposed frontier after review and breakdown approval: T01 (remaining reviews), T02 (AI prefactor), T03 (integration
profile), T06 (credential redirects). Work one ticket at a time with `$implement`,
clearing context between tickets; frontier independence is not a request to run
agents in parallel.

| Accepted decision | Primary tickets |
|---|---|
| 1A complete scope, staged enablement | All; T25 release gate |
| 2A shared transaction coordinator | T04; adopted by each mutation slice |
| 3A operation generations | T17–T19, T21, T23–T24 |
| 4A selected branch follows existing documents | T22 |
| 5A scheduled cleanup | T24 |
| 6A uncertain delivery retries | T09–T10 |
| 7A explicit scan error categories | T21 |
| 8A secret-free request metadata | T09–T11, T25 deployment checks |
| 9A stable repository/owner identity | T20–T22 |
| 10A authenticated redirect boundary | T06, T20 |
| 11A shared reliable sign-out | T05, T11 |
| 12A live asset delivery, 12B only future option | T07–T08, T16, T25 |
| 13A target revision checks | T10, T12, T16, T20, T22 |
| 14A atomic encrypted invitation enqueue | T09–T10 |
| 15A one active content update | T19 |
| 16A consolidate AI starts; refactor as needed | T02, T23 |
| 17A required focused CI | T03; extended in every relevant slice |
| 18A batched request-local read facts; fresh writes/jobs | T11–T12 and each affected read/mutation slice |
| 19A bounded coordinator contention and safe retries | T04 and each affected mutation/worker/UI slice |
| 20A bounded scans and complete paginated latest reports | T21–T22, T24–T25; reassess slice size after review |
| Remaining review | In progress before ticket publishing; reconcile proposed T01 |

Dependency edges are implementation prerequisites, not shared-directory warnings.
There are no cycles; T25 transitively includes every implementation slice. Publishing
and changing the roadmap to ticketed wait for granularity approval. Ticketing is paused while the active engineering review updates the spec.
