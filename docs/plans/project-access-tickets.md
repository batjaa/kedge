# Project access — proposed ticket breakdown

> **2026-09-27 sequencing update:** workspace membership and action/role contracts
> are now specced first in M4.0 (engineering review pending). This artifact describes the prior project-first
> scope; preserve its useful decisions, but rebase it before implementation or
> ticket publication. See the [workspace foundation spec](../specs/m4.0-workspace-membership.md).

> 2026-09-27 · Revised draft for granularity/dependency approval; not published.
> Module parent: **Project access: invitations and project roles (M4.1)**.
> Tracker: GitHub, native sub-issues and dependencies plus canonical Blocked by lines.
> Spec: [M4.1](../specs/m4.1-project-access.md) · [Roadmap](../ROADMAP.md).

Engineering review is complete: decisions 1A–21A and user-directed ordinary
deployment (22) are included below. This proposal has one parent and 27 children.
The remaining visual design review is T01 and blocks the new invitation UI via
T10; publishing with that prerequisite is an alternative to completing design
review before ticketing and requires the user's approval of this breakdown.

Numbers below are draft IDs, not GitHub issue numbers. Existing
[#156](https://github.com/batjaa/kedge/issues/156) remains a separate verification
recovery issue and blocks final acceptance/release checks, not unrelated work.
No module issues have been published and this revised breakdown is not approved.

## Rules shared by implementation tickets

Each slice delivers its complete relevant flow through persistence, API, UI and
verification. T02/T04/T07 are prefactors exercised through existing journeys;
T03 is a verifiable integration-profile slice. UI uses the existing design system,
four locales, both themes, keyboard/mobile behavior and explicit recovery states.
Every changed behavior carries its own authorization/denial, audit, failure and
regression tests; T27 verifies the assembled experience rather than supplying
missing tests. Follow the accepted coverage map and 17A integration profile.

Use bounded page/grant reads and response-only reuse (18A), fresh protected
write/job checks, and bounded contention with safe recovery (19A). Preserve
independent workspace/Share authorities and the seam for later workspace access.
Lifecycle changes carry 21A safe diagnostic events; T26 adds aggregate checks and
independent monitor wiring. Integrate the complete permission boundary before
releasing invitations. Follow decision 22: ordinary deployment and manual recovery,
with no additional maintenance/fleet-control system.

## Dependency overview

1. **Complete the project-access visual design review** — **Blocked by:** None — can start immediately. **Delivers:** Approve the invitation, Members, Shared with you, role-change and access-loss journeys using the existing design language.
2. **Consolidate AI generation starts** — **Blocked by:** None — can start immediately. **Delivers:** Digest, Improve-the-doc Prompt and Split Proposal requests use the same start/join and failure behavior already used by Ask and thread AI.
3. **Add the required database-and-worker integration profile** — **Blocked by:** None — can start immediately. **Delivers:** A required CI check and a matching local command run real queue and concurrency tests without replacing the existing fast suites.
4. **Introduce the shared transaction boundary through comment writes** — **Blocked by:** T03. **Delivers:** Existing comment and reply writes demonstrate one reusable transaction boundary for live authorization and resource placement.
5. **Make shared sign-out reliable for account switching** — **Blocked by:** T03. **Delivers:** Ordinary sign-out confirms that the old account is gone and supports reliable return to an internal destination.
6. **Keep repository credentials within their original origin** — **Blocked by:** None — can start immediately. **Delivers:** Authenticated source discovery and document fetches refuse redirects that would expose credentials.
7. **Bound tracked scans and paginate complete latest reports** — **Blocked by:** T03. **Delivers:** Existing tracked-repository scans handle accumulated document history in bounded batches and show complete paginated results.
8. **Serve imported images through document-authorized delivery** — **Blocked by:** T03. **Delivers:** Images remain readable through valid document, Share or Demo Document access, while copied storage URLs no longer bypass access checks.
9. **Protect cached diagrams and complete legacy media migration** — **Blocked by:** T08. **Delivers:** Diagrams use the same document-authorized delivery boundary, including existing cached assets.
10. **Send a project invitation and show its safe preview** — **Blocked by:** T01, T04. **Delivers:** The workspace owner can invite a named recipient from Members, see delivery status, and send a link that reveals only the permitted preview.
11. **Resend and revoke pending invitations safely** — **Blocked by:** T10. **Delivers:** The owner can recover delivery, replace an old invitation link or revoke a pending offer from Members.
12. **Accept an invitation and discover the shared project** — **Blocked by:** T05, T09, T11. **Delivers:** A matching verified account explicitly joins and finds the project under Shared with you, with safe read-only access and no sibling-workspace disclosure.
13. **Manage project members, roles and voluntary leaving** — **Blocked by:** T12. **Delivers:** Members shows effective access and lets authorized people invite, change roles, remove others or leave their own direct membership.
14. **Enable role-aware commenting, own-thread actions and mentions** — **Blocked by:** T13. **Delivers:** Project Reviewers and Maintainers can discuss documents and manage their own contributions, while Viewers remain read-only.
15. **Enable version-pinned approvals and suggestion decisions** — **Blocked by:** T13. **Delivers:** Project Reviewers approve under their own identity, and Maintainers decide proposed suggestions without impersonating another reviewer.
16. **Enable Maintainer project and review moderation** — **Blocked by:** T13. **Delivers:** Maintainers can edit project details, change document lifecycle and moderate threads without rewriting others’ contributions.
17. **Manage document Shares and move documents between project audiences** — **Blocked by:** T13. **Delivers:** Maintainers can manage project-document Shares and move a document between projects they maintain, with its complete review history.
18. **Import public and pasted documents as a Maintainer** — **Blocked by:** T06, T13. **Delivers:** Maintainers add documents to the invited project using pasted/uploaded content or credential-free public sources.
19. **Re-sync documents with current source authority** — **Blocked by:** T18. **Delivers:** Maintainers refresh an accessible source while preserving Document identity, review anchors and the last good version on failure.
20. **Replace pasted content without losing a competing editor’s draft** — **Blocked by:** T19. **Delivers:** A Maintainer can submit a new version of pasted content; a competing editor receives a clear busy state and keeps their draft.
21. **Approve private repositories and delegate file import and re-sync** — **Blocked by:** T19. **Delivers:** The owner approves a repository for a project, then a Maintainer can import or refresh its files without accessing workspace credentials.
22. **Add and scan Tracked Repos with delegated project access** — **Blocked by:** T21, T07. **Delivers:** Maintainers attach approved private or public Tracked Repos, preview matches, scan them and read a report limited to their current audience.
23. **Change tracked branches and path filters without losing document identity** — **Blocked by:** T22. **Delivers:** Maintainers change a Tracked Repo’s selected branch or paths while existing documents keep their identity and review history.
24. **Enable role-aware AI tools and private artifacts** — **Blocked by:** T02, T13. **Delivers:** Reviewers use Ask and reply drafts, Maintainers use all existing AI tools, and Viewers read only shared artifacts.
25. **Recover revoked or abandoned project operations without a browser visit** — **Blocked by:** T22, T24. **Delivers:** The scheduler settles stranded imports, re-syncs, scans and AI Runs safely so users do not return to permanent pending states.
26. **Detect stalled project work with independent operational checks** — **Blocked by:** T25. **Delivers:** Operators can detect and diagnose stalled invitation delivery, workers and cleanup without depending on those processes or Nightwatch.
27. **Verify the complete access boundary and enable invitations** — **Blocked by:** T14, T15, T16, T17, T20, T23, T26, #156. **Delivers:** The complete project-access experience is ready to enable in both editions, with verified migration, recovery and operational behavior.

## Draft issue bodies

The shared implementation rules above accompany each applicable published child.

## T01 — Complete the project-access visual design review

### Spec

docs/specs/m4.1-project-access.md

### What to build

Approve the invitation, Members, Shared with you, role-change and access-loss journeys using the existing design language.

### Acceptance criteria

- [ ] Walk the complete acceptance/account-switch, member administration, owner-approved source and access-loss journeys, including loading, empty, error, partial and success states.
- [ ] Confirm keyboard/focus behavior, narrow-screen layouts, both themes and all four locales using the existing design system.
- [ ] Record actionable UI decisions and reconcile affected implementation ticket criteria before their new surfaces are built.
- [ ] Preserve accepted engineering decisions 1A–21A and the ordinary-deployment choice (22); do not reopen completed engineering review.

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
- [ ] Apply 19A: a finite total contention budget with safe retries only after confirmed rollback, fresh authority and original target revision; no external/paid replay, no falsely successful removal, and recoverable busy outcomes.

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
- [ ] Preserve clear source-error recovery; repository approval identity checks are added by T21.

### Blocked by

Blocked by: None — can start immediately

## T07 — Bound tracked scans and paginate complete latest reports

### Spec

docs/specs/m4.1-project-access.md

### What to build

Existing tracked-repository scans handle accumulated document history in bounded batches and show complete paginated results.

### Acceptance criteria

- [ ] Refactor the existing scan journey through bounded database batches; the current-match file cap must not be treated as a bound on retained document history.
- [ ] Persist complete per-file results and scoped totals, with database pagination and loading/empty/error states in the existing report UI; do not retain only a capped detail sample.
- [ ] Stage results under scan/configuration generation and atomically publish valid completed reports; keep prior valid results until replacement and show current progress/failure separately.
- [ ] Pin pages to one publication, return explicit refresh for retired generations, reauthorize each read, and prevent stale or failed workers from overwriting newer results.
- [ ] Migrate legacy report data; test history well above the match cap, page boundaries, bounded allocations, publication/failure races and cleanup without changing Document identity, content or review history.

### Blocked by

Blocked by: T03

## T08 — Serve imported images through document-authorized delivery

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

## T09 — Protect cached diagrams and complete legacy media migration

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

Blocked by: T08

## T10 — Send a project invitation and show its safe preview

### Spec

docs/specs/m4.1-project-access.md

### What to build

The workspace owner can invite a named recipient from Members, see delivery status, and send a link that reveals only the permitted preview.

### Acceptance criteria

- [ ] Provide paginated pending invitations, three grantable roles with Reviewer default, normalized email validation, duplicate/member conflict handling and inherited owner identity.
- [ ] Persist the invitation generation, required audit and encrypted delivery job atomically on the same database connection; reject incompatible configuration.
- [ ] Use seven-day tokens, bounded same-generation retries and honest uncertain-delivery status; rollback/crash tests prove no stranded queued invitation.
- [ ] Preview GET grants no membership/session/verification; cover token redaction in nested auth destinations, logs and headers plus no-store/no-referrer/noindex, including errors.
- [ ] Keep invitation entry points behind the agreed rollout control until T27; demonstrate using controlled mail and actual links.

### Blocked by

Blocked by: T01, T04

## T11 — Resend and revoke pending invitations safely

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

Blocked by: T10

## T12 — Accept an invitation and discover the shared project

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
- [ ] Apply 18A to project/discovery/roster reads: batch only the current page, scope read reuse to actor/credential/surface, and prove bounded query counts plus fresh next-request and write/job authority.

### Blocked by

Blocked by: T05, T09, T11

## T13 — Manage project members, roles and voluntary leaving

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

Blocked by: T12

## T14 — Enable role-aware commenting, own-thread actions and mentions

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

Blocked by: T13

## T15 — Enable version-pinned approvals and suggestion decisions

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

Blocked by: T13

## T16 — Enable Maintainer project and review moderation

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

Blocked by: T13

## T17 — Manage document Shares and move documents between project audiences

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

Blocked by: T13

## T18 — Import public and pasted documents as a Maintainer

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

Blocked by: T06, T13

## T19 — Re-sync documents with current source authority

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

Blocked by: T18

## T20 — Replace pasted content without losing a competing editor’s draft

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

Blocked by: T19

## T21 — Approve private repositories and delegate file import and re-sync

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

Blocked by: T19

## T22 — Add and scan Tracked Repos with delegated project access

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
- [ ] Extend the complete paginated latest-report foundation to direct project grants: each page and total rechecks current source/document reach, and revoked or moved authority cannot disclose historical paths.

### Blocked by

Blocked by: T21, T07

## T23 — Change tracked branches and path filters without losing document identity

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

Blocked by: T22

## T24 — Enable role-aware AI tools and private artifacts

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

Blocked by: T02, T13

## T25 — Recover revoked or abandoned project operations without a browser visit

### Spec

docs/specs/m4.1-project-access.md

### What to build

The scheduler settles stranded imports, re-syncs, scans and AI Runs safely so users do not return to permanent pending states.

### Acceptance criteria

- [ ] Use bounded database batches and generation-conditional terminal writes independent of the work queue; legitimate queue/runtime/retry budgets are respected.
- [ ] Preserve last good content and AI spend; never automatically restart imports or paid generation.
- [ ] Repeated cleanup and races with replacement work are harmless; database/scheduler outage has explicit diagnostics and recoverable operation.
- [ ] Demonstrate no-browser recovery and scheduler operation in both deployment modes using required real-database tests.
- [ ] Clean abandoned staged report results and obsolete publications in bounded generation-safe work, preserving the current valid report and returning an explicit refresh outcome for retired pages.

### Blocked by

Blocked by: T22, T24

## T26 — Detect stalled project work with independent operational checks

### Spec

docs/specs/m4.1-project-access.md

### What to build

Operators can detect and diagnose stalled invitation delivery, workers and cleanup without depending on those processes or Nightwatch.

### Acceptance criteria

- [ ] Correlate admission, handoff, execution, terminal outcomes, obsolete-generation skips and contention using safe IDs/reasons/timings; redact tokens, links, recipient emails, credentials and content.
- [ ] Provide bounded read-only status for queue age/backlog, overdue work, last successful cleanup and lock-budget failures; distinguish idle, stale, never-run and unavailable states.
- [ ] Document thresholds that respect legitimate waiting/backoff, usable status output and recovery procedures; wire the deployment monitor independently of the monitored queue/scheduler.
- [ ] Reuse existing logging, Laravel and deployment mechanisms; require no Nightwatch or new mandatory monitoring platform, and never mutate work or restart paid operations from a check.
- [ ] Prove stopped-worker/scheduler and failing-mail detection plus recovery with Nightwatch disabled; telemetry failure cannot undo committed actions or block access reduction, while required transactional audits remain atomic.

### Blocked by

Blocked by: T25

## T27 — Verify the complete access boundary and enable invitations

### Spec

docs/specs/m4.1-project-access.md

### What to build

The complete project-access experience is ready to enable in both editions, with verified migration, recovery and operational behavior.

### Acceptance criteria

- [ ] Execute the accepted capability and coverage-map contracts, including grant combinations, current/legacy media, real-mail accept/remove and unchanged MCP refusal; earlier slices already carry their own tests.
- [ ] Use ordinary Coolify/Compose deployment: additive migrations/data conversion, API/worker/scheduler restarts, the matching web build and core smoke checks; document manual compatible redeploy or fix-forward recovery.
- [ ] Accept temporary interruption at the current low-traffic, pre-customer stage; introduce no maintenance cutover, rolling compatibility release, fleet-version gate, enforced rollback floor or separate drain protocol.
- [ ] Verify implemented operational signals and independent monitoring, bounded query/lock/batch behavior, configured queue/scheduler and private storage/cache delivery.
- [ ] Complete keyboard/mobile/both-theme/four-locale journeys on Kedge’s actual documentation project; existing clients still fail closed on missing capability fields.
- [ ] Ensure existing verification-recovery issue #156 is resolved before the acceptance/release smoke; demonstrate the complete permission boundary before making invitations available.

### Blocked by

Blocked by: T14, T15, T16, T17, T20, T23, T26, #156

## Frontier and review changes

After approval/publication, the initial frontier is T01 (visual design), T02 (AI
prefactor), T03 (integration profile) and T06 (credential redirects). Work one ticket
per `$implement` session, clearing context between tickets. Independence does not
request parallel agents or worktrees.

Changes from the original 25-ticket proposal:

- Replace the completed engineering-review prerequisite with visual design only.
- Add T07 for 20A's bounded scans and complete paginated report, as a prefactor to
  delegated scans (T22).
- Add T26 for 21A's independent operational checks after recovery (T25).
- Add 18A page/query/freshness criteria to discovery (T12) and shared rules.
- Add 19A contention/retry criteria to the shared coordinator (T04) and its callers.
- Simplify T27 deployment to the user's ordinary-deploy choice; remove proposed
  maintenance, rolling-release and fleet-gate requirements.

Dependency order and transitive coverage are checked: no cycles or redundant
edges, and T27 transitively includes every child plus external issue #156.
Publishing and the roadmap's `ticketed` status await this breakdown's approval.
The module spec is unchanged by this ticketing pass.
