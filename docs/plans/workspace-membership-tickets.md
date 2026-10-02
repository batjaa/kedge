# Workspace membership — published ticket breakdown

> Published 2026-10-01 · Approved 29-ticket breakdown; native GitHub hierarchy and dependencies verified.
> Module parent: [#160 — Workspace membership and resource authorization (M4.0)](https://github.com/batjaa/kedge/issues/160).
> Tracker: GitHub native sub-issues and dependencies, with canonical Blocked by lines.
> Spec: [M4.0](../specs/m4.0-workspace-membership.md) · [Roadmap](../ROADMAP.md).

Engineering decisions 1A–7A and design decisions D1A–D4A are complete. The published
breakdown contains one parent and **29 children**, not 29 new product decisions. W IDs
are stable planning identifiers; their GitHub issue mapping appears below. The [project rebase map](project-access-workspace-rebase.md)
identifies shared work absorbed here and the remaining M4.1 scope.

## Shared delivery rules

Each ticket owns its relevant persistence, API, UI, audit, denial/failure and
migration tests. W01 is a verifiable harness slice; W02/W03/W04 are prefactors
exercised through existing behavior. Subsequent slices extend those boundaries
through complete user flows. Reference sections below are in the module spec;
coverage IDs refer to the [test map](workspace-membership-test-map.md).

Work sequentially, one ticket per fresh implementation session. Dependency edges
describe actual prerequisites, not permission to parallelize overlapping services.
Because replacing the authorization boundary spans many resource families, use a
shared feature integration branch until W29 verifies the complete boundary. Require
each slice’s relevant checks, and green full integration at that final boundary.
Do not preserve legacy API/Share compatibility or expose invitations on a partial
boundary. This is development sequencing, not a new deployment or maintenance gate.

Every affected route uses Policies and explicit targets, live grants, bounded scoped
queries and safe capability projections. Every protected mutation/result uses the
shared coordinator and original revisions/authority. Every UI slice includes the
approved states, four locales, both themes and keyboard/mobile behavior. Definitions
and denial behavior remain explicit; tests must assert forbidden effects as well as
responses. Required audit/enqueue failures roll back; optional telemetry does not
undo committed changes. Final verification assembles existing per-ticket evidence.

Published issue bodies include these shared rules and real GitHub blocker numbers.
[#156](https://github.com/batjaa/kedge/issues/156) was rechecked and remains **open** on
2026-10-01. It blocks final acceptance, not unrelated implementation; its diagnosis
and deployed-account recovery remain owned by that existing issue.

## Dependency overview

1. **W01 — Run access contracts with real databases and workers** — **Blocked by:** None. **Delivers:** A reproducible local and required CI profile exercises committed transactions, asynchronous jobs and browser flows on the supported databases.
2. **W02 — Introduce role catalogs and lifecycle membership through existing access** — **Blocked by:** None. **Delivers:** Existing account provisioning and workspace reads use explicit role definitions and live membership records, preserving personal workspace identity.
3. **W03 — Serialize protected mutations through comment writes** — **Blocked by:** W01, W02. **Delivers:** An existing comment/reply write and a competing membership change have one truthful commit ordering on both databases.
4. **W04 — Unify HTTP failures and preserve uncertain writes** — **Blocked by:** None. **Delivers:** Existing web forms decode safe Problem Details, retain input and distinguish confirmed failure from an unknown write outcome.
5. **W05 — Select an explicit workspace and browse its resources** — **Blocked by:** W03, W04. **Delivers:** A person switches beside the Kedge logo into a workspace home and browses its projects, documents, directory and permitted settings.
6. **W06 — Bind shared review to an exact Share and participant** — **Blocked by:** W03, W04. **Delivers:** Shared-document readers and reviewers use explicit Share routes with the same review services and a strictly selected authority.
7. **W07 — Deliver imported images through live document access** — **Blocked by:** W06. **Delivers:** Images render for current member, Share and demo access while copied backing-storage URLs grant nothing.
8. **W08 — Protect diagrams and finish legacy asset closure** — **Blocked by:** W07. **Delivers:** Cached diagrams use private authorized delivery and all legacy media URLs obey the new boundary.
9. **W09 — Send a workspace invitation and preview the offer** — **Blocked by:** W05. **Delivers:** Owner/Admin invite a named recipient from Members and see a durable delivery state; the recipient can inspect a safe offer.
10. **W10 — Resend and revoke invitation generations safely** — **Blocked by:** W09. **Delivers:** An administrator recovers mail delivery or withdraws an offer without reviving old links or overwriting a newer outcome.
11. **W11 — Make account switching confirm server logout** — **Blocked by:** W01, W04. **Delivers:** Ordinary sign-out and invitation account switching preserve a safe destination and cannot silently return to the old account.
12. **W12 — Accept an invitation into the named workspace** — **Blocked by:** W10, W11. **Delivers:** A matching verified account explicitly joins, reaches the workspace and reads its resources without changing personal identity.
13. **W13 — Change roles, remove members and leave a workspace** — **Blocked by:** W12. **Delivers:** Administrators manage allowed roles and people can leave joined workspaces with accurate remaining-access consequences.
14. **W14 — Apply workspace roles to discussion and moderation** — **Blocked by:** W05. **Delivers:** Member+ discuss documents and manage their own contributions; Owner/Admin moderate without rewriting another person’s words.
15. **W15 — Apply workspace roles to approvals and suggestions** — **Blocked by:** W14. **Delivers:** Member+ approve under their own identity; document creators or Owner/Admin decide suggestions with existing version rules.
16. **W16 — Organize projects, document lifecycle, moves and Shares** — **Blocked by:** W05. **Delivers:** Members organize their own content and Owner/Admin manage workspace content while preserving document identity and review history.
17. **W17 — Import content with explicit workspace and source authority** — **Blocked by:** W16. **Delivers:** Member+ import public URL, paste and upload content; only Owner can use stored workspace credentials.
18. **W18 — Retry and re-sync using the original operation authority** — **Blocked by:** W17. **Delivers:** Authorized people explicitly retry or refresh a document while preserving last good content and rejecting obsolete worker results.
19. **W19 — Replace pasted content without losing a competing draft** — **Blocked by:** W18. **Delivers:** An authorized editor creates a new version of pasted/uploaded content; a competing editor keeps their unsent changes.
20. **W20 — Scan tracked repositories and publish complete paginated reports** — **Blocked by:** W18. **Delivers:** Authorized people preview/create/scan tracked sources and inspect a complete latest report with bounded processing.
21. **W21 — Change tracked branches and filters without losing history** — **Blocked by:** W20. **Delivers:** A tracked-source owner or authorized administrator changes branch/path selection while existing documents keep their identity.
22. **W22 — Preserve anonymous demo import and claim only settled work** — **Blocked by:** W18. **Delivers:** A demo visitor waits for import to settle, then explicitly claims into an authorized workspace; failed imports can be retried separately.
23. **W23 — Bind Agent Tokens and MCP to live workspace membership** — **Blocked by:** W05. **Delivers:** Member+ mint a token for the selected workspace and its tools honor current role power; old incarnations never regain access.
24. **W24 — Unify six AI starts with workspace roles and private artifacts** — **Blocked by:** W05. **Delivers:** Member+ use the six existing AI tools through one admission flow; private artifacts remain actor-only even from Owner/Admin.
25. **W25 — Checkpoint AI calls through a complete Digest run** — **Blocked by:** W24. **Delivers:** A chunked Digest reuses completed calls, fences provider execution and retries final publication without generating again.
26. **W26 — Use durable call recovery across all six AI tools** — **Blocked by:** W25. **Delivers:** Every generator follows the same safe-resumption contract and the user can distinguish saved progress from an uncertain interrupted run.
27. **W27 — Settle abandoned work independently of browser traffic** — **Blocked by:** W13, W20, W22, W26. **Delivers:** The scheduler settles revoked or abandoned imports, scans, demos and AI without a browser visit or functioning work queue.
28. **W28 — Expose independent operational checks and recovery guidance** — **Blocked by:** W27. **Delivers:** Operators can distinguish healthy idle from stalled queue, cleanup and protected writes using checks outside the monitored processes.
29. **W29 — Verify the complete workspace boundary and ordinary deployment** — **Blocked by:** W08, W15, W19, W21, W23, W28, #156. **Delivers:** The assembled foundation is ready to release with complete resource authorization, verified migration and real operational smoke evidence.

## Issue body source

## W01 — Run access contracts with real databases and workers

### Spec

docs/specs/m4.0-workspace-membership.md — Testing Decisions; §9.

### What to build

A reproducible local and required CI profile exercises committed transactions, asynchronous jobs and browser flows on the supported databases.

### Acceptance criteria

- [ ] Run PostgreSQL and file-backed SQLite with independent connections, controlled barriers, isolated committed fixtures and bounded process cleanup; retain the existing fast suites.
- [ ] Boot a database queue worker and shared session/cache state; prove readiness through an existing queued-mail flow and transaction contract.
- [ ] Provide controllable mail/provider transports that record requests across processes, drop responses after acceptance and permit worker termination at defined boundaries; never use paid live calls.
- [ ] Fail for unavailable prerequisites, empty required selection or skipped mandatory scenarios. Document the exact local command and safe diagnostics; later slices extend this profile.

Required proof: C07/C12/C20, plus the shared delivery rules above.

### Blocked by

Blocked by: None — can start immediately

## W02 — Introduce role catalogs and lifecycle membership through existing access

### Spec

docs/specs/m4.0-workspace-membership.md — §2–5, §11.

### What to build

Existing account provisioning and workspace reads use explicit role definitions and live membership records, preserving personal workspace identity.

### Acceptance criteria

- [ ] Implement the explicit action matrix, definition revisions, scopes/provenance, delegation ceilings and shared Policy/query/capability contracts; unknown or invalid definitions deny. Prove a test-only workspace-owned role provider without production custom-role storage.
- [ ] Promote the existing membership table to a lifecycle model with unique workspace/user identity, active/revoked state, incarnation and grant revision. Active convenience relations exclude revoked history; explicit history/locking queries retain it.
- [ ] Provision exactly one protected Owner in each human workspace and no human memberships in the reserved demo workspace. Backfill stable personal references, role keys and creator attribution, reporting anomalies and Owner fallbacks.
- [ ] Replace pivot lifecycle writes, closed resolver casts and raw membership-existence access checks with the shared live-grant boundary. Exercise existing reads/provisioning and denial after revocation; individual resource actions migrate in the slices below.
- [ ] Preserve IDs and attribution, record the changed legacy Member powers, and test migration/repair behavior. Do not manufacture verified emails or workspace memberships for Shares or future project guests.

Required proof: C01/C02/C21, plus the shared delivery rules above.

### Blocked by

Blocked by: None — can start immediately

## W03 — Serialize protected mutations through comment writes

### Spec

docs/specs/m4.0-workspace-membership.md — §4, §7, §9.

### What to build

An existing comment/reply write and a competing membership change have one truthful commit ordering on both databases.

### Acceptance criteria

- [ ] Implement one reusable coordinator with ordered workspace guards, grant/credential/resource locks, fresh Policy checks and expected revisions; integrate the existing comment/reply and MCP token-revocation transaction boundaries.
- [ ] Prove removal before/after commit, role and placement ABA, rollback and multi-resource ordering on PostgreSQL and file SQLite; SQLite needs a real serialization protocol.
- [ ] Enforce the five-second total contention budget, at most three attempts and bounded jitter/deadlines. Retry only classified contention after confirmed rollback with original intent and fresh authority.
- [ ] Keep external calls outside locks; never replay external or paid work during transaction retries. Return safe busy outcomes without falsely reporting a successful removal.

Required proof: C07/C08, plus the shared delivery rules above.

### Blocked by

Blocked by: W01, W02

## W04 — Unify HTTP failures and preserve uncertain writes

### Spec

docs/specs/m4.0-workspace-membership.md — §10.1.

### What to build

Existing web forms decode safe Problem Details, retain input and distinguish confirmed failure from an unknown write outcome.

### Acceptance criteria

- [ ] Centralize affected HTTP error rendering and client decoding, preserving native MCP/job errors and endpoint-specific success envelopes; cover all specified status/type/recovery combinations.
- [ ] Validate success shapes including valid 204, unknown problem types, malformed/truncated JSON and non-JSON proxy errors. Failed reads show unavailable, not empty; ambiguous writes offer reconciliation with no automatic replay or false success.
- [ ] Allow one recognized pre-handler CSRF refresh only with the same actor, target and revisions. Stop if identity changes; keep drafts and validated internal auth-return destinations.
- [ ] Exercise an existing settings write end to end, including a lost committed response. Redact tokens and nested return URLs before capture, project safe field errors and preserve privacy headers on errors.

Required proof: C18/C22; F04, plus the shared delivery rules above.

### Blocked by

Blocked by: None — can start immediately

## W05 — Select an explicit workspace and browse its resources

### Spec

docs/specs/m4.0-workspace-membership.md — §4, §8, §10.

### What to build

A person switches beside the Kedge logo into a workspace home and browses its projects, documents, directory and permitted settings.

### Acceptance criteria

- [ ] Replace personal collection/settings aliases for workspace discovery, projects/documents lists, summary/activity and settings; migrate matching web/BFF callers and documentation together. One context flows through validation, scopes, capabilities and audit; resource-ID targets derive stored ownership.
- [ ] Implement D1A/D3A: a named mobile-visible switcher distinct from identity, paginated membership list, destination Documents/home on change, current selection no-op and truthful loading/failure states.
- [ ] Provide workspace settings, read-only roles and the Members directory with safe email projection, bounded SQL search/counts/pages and per-context caches. Only Owner/Admin rename; all members see all projects and Unfiled.
- [ ] Keep personal identity stable, tabs independent and existing forms bound to their original workspace; suppress stale responses after navigation. Losing access offers personal-workspace recovery without automatic resubmission.
- [ ] Prove two-workspace/hidden-target cases, large-page query bounds, matching-name disambiguation and responsive/keyboard behavior. Remaining create/source/token aliases are removed by their owning slices.

Required proof: C03/C19/C22; F04, plus the shared delivery rules above.

### Blocked by

Blocked by: W03, W04

## W06 — Bind shared review to an exact Share and participant

### Spec

docs/specs/m4.0-workspace-membership.md — §8.1, §9.

### What to build

Shared-document readers and reviewers use explicit Share routes with the same review services and a strictly selected authority.

### Acceptance criteria

- [ ] Migrate shared reader/review clients, routes, mentions, capabilities and cache keys together; token-only visitors can read, while writes require a verified participant on that exact active Share.
- [ ] Reject wrong-document children and participants from another Share of the same document. No workspace/member/MCP request falls back to Share authority and no shared request falls back to membership.
- [ ] Reuse existing business services through the coordinator, rechecking selected Share/participant at commit. Preserve the narrower review powers and prohibit directory, credentials and private AI exposure.
- [ ] Remove implicit legacy routes without compatibility redirects or link migration. Cover Share revocation races, deliberate independent-Share access after workspace removal, and token redaction/privacy headers.

Required proof: C09/C22; F06, plus the shared delivery rules above.

### Blocked by

Blocked by: W03, W04

## W07 — Deliver imported images through live document access

### Spec

docs/specs/m4.0-workspace-membership.md — §9, §11.

### What to build

Images render for current member, Share and demo access while copied backing-storage URLs grant nothing.

### Acceptance criteria

- [ ] Use private backing storage and a live document/asset association check on every image delivery; integrate all three legitimate reading contexts and safe missing-object behavior.
- [ ] Close public origin/CDN/cache bypasses and disallow public signed-storage URL fallback. Recheck access on new requests after revocation.
- [ ] Migrate existing image references without changing document content hashes, anchors or review identity; report migration failures explicitly.
- [ ] Prove wrong associations, inaccessible documents, Share/demo expiry and local/private-object-storage behavior; document deployment origin checks for final smoke.

Required proof: C16; F06, plus the shared delivery rules above.

### Blocked by

Blocked by: W06

## W08 — Protect diagrams and finish legacy asset closure

### Spec

docs/specs/m4.0-workspace-membership.md — §9, §11.

### What to build

Cached diagrams use private authorized delivery and all legacy media URLs obey the new boundary.

### Acceptance criteria

- [ ] Apply the same live association/context checks to cached and newly rendered diagrams, retaining content-addressed reuse behind the private boundary.
- [ ] Preserve Kroki allowlisting and show-source/render-failure behavior; untrusted or missing assets cannot crash the reader.
- [ ] Complete legacy diagram reference/storage migration and public-origin closure with unchanged hashes/anchors and valid current Share/demo access.
- [ ] Test old direct URLs, revoked contexts, storage/render failures and both editions; do not claim deployment cache closure until its smoke check runs.

Required proof: C16/C21, plus the shared delivery rules above.

### Blocked by

Blocked by: W07

## W09 — Send a workspace invitation and preview the offer

### Spec

docs/specs/m4.0-workspace-membership.md — §5–6, §10.

### What to build

Owner/Admin invite a named recipient from Members and see a durable delivery state; the recipient can inspect a safe offer.

### Acceptance criteria

- [ ] Implement D2A Members/Invitations navigation and D4A desktop dialog/mobile sheet, Member default, allowed-role choices, role details and all-projects/Unfiled disclosure. Ordinary members cannot fetch invitations or recipient email.
- [ ] Persist one current normalized-email slot, role-definition/inviter evidence, digest/generation and seven-day expiry. Duplicate pending requests reuse the offer without resending; active members receive conflict and a role-change destination.
- [ ] Commit offer, required audit and encrypted delivery job on the same application database transaction. Reject incompatible sync/connection configuration; rollback or crash leaves no partial offer and no plaintext token in failed jobs.
- [ ] Deliver only a current authorized generation; expose queued/transport-accepted/failed/uncertain truthfully. GET preview grants no verification, session or membership and reveals only the permitted offer fields.
- [ ] Test wrong ceilings, stale definitions, duplicate requests, enqueue/audit failure and safe preview. Include focus/dirty/pending dismissal, unknown-send reconciliation, both themes and localized narrow-screen behavior.

Required proof: C04/C22; F01/F05, plus the shared delivery rules above.

### Blocked by

Blocked by: W05

## W10 — Resend and revoke invitation generations safely

### Spec

docs/specs/m4.0-workspace-membership.md — §6–7, §10.

### What to build

An administrator recovers mail delivery or withdraws an offer without reviving old links or overwriting a newer outcome.

### Acceptance criteria

- [ ] Implement revision-checked resend/revoke controls, sixty-second cooldown, seven-day renewed expiry and explicit token rotation. Role changes require revoke plus a new invitation.
- [ ] Reissue expired/revoked slots and accepted slots only when the recipient has no active membership; retain audit history and invalidate old tokens.
- [ ] Keep automatic delivery retries bounded on the same token/expiry. Conditional late status updates cannot overwrite resend/acceptance; uncertain delivery may duplicate the same link and must say it may have arrived.
- [ ] Recheck inviter grant power and offered definition on every attempt; authority restoration cannot revive cancelled generations. Prove failed resend preserves the old offer, concurrent stale actions and encrypted queue/log redaction.

Required proof: C04/C20/C22; F05, plus the shared delivery rules above.

### Blocked by

Blocked by: W09

## W11 — Make account switching confirm server logout

### Spec

docs/specs/m4.0-workspace-membership.md — §6, §10.1.

### What to build

Ordinary sign-out and invitation account switching preserve a safe destination and cannot silently return to the old account.

### Acceptance criteria

- [ ] Reproduce the concurrent-session restoration race on the actual session driver, then implement the smallest demonstrated fix including remember-me/session rotation.
- [ ] Use one shared sign-out client flow that waits for confirmed success and retains retry on failure/uncertainty; preserve only validated internal return destinations.
- [ ] Prove concurrent requests cannot restore old identity after confirmed logout using controlled overlap, not browser network-idle.
- [ ] Cover unknown/non-JSON responses and exhausted CSRF recovery without weakening verified-recipient or normal protected-resource enforcement.

Required proof: C18/C22; F02, plus the shared delivery rules above.

### Blocked by

Blocked by: W01, W04

## W12 — Accept an invitation into the named workspace

### Spec

docs/specs/m4.0-workspace-membership.md — §5–6, §8, §10.

### What to build

A matching verified account explicitly joins, reaches the workspace and reads its resources without changing personal identity.

### Acceptance criteria

- [ ] Provide the standalone offer/account-state page and sign-in/sign-up/confirmation/OAuth/Reviewer-upgrade return paths; returning from auth never auto-accepts.
- [ ] Accept only through authenticated CSRF-protected POST with the exact normalized verified recipient, current offer, role definition and current inviter grant power.
- [ ] Atomically activate membership and mark accepted; concurrent accepts produce one grant. Existing membership is never overwritten; replay succeeds only for the original active accepted incarnation and never restores an old role.
- [ ] Prove new/existing/unverified/wrong/GitHub/upgraded accounts, inactive links, definition changes and remove/rejoin replay. A newly joined workspace is selectable and all-projects/Unfiled scope is visible.
- [ ] Run the real worker/mailbox browser acceptance path. This ticket proves local integration, not permission to release before the full foundation is complete.

Required proof: C02/C05/C22; F01/F02/F05, plus the shared delivery rules above.

### Blocked by

Blocked by: W10, W11

## W13 — Change roles, remove members and leave a workspace

### Spec

docs/specs/m4.0-workspace-membership.md — §3, §5, §7, §10.

### What to build

Administrators manage allowed roles and people can leave joined workspaces with accurate remaining-access consequences.

### Acceptance criteria

- [ ] Enforce Owner/Admin ceilings, immutable Owner, Admin self-leave versus forbidden self-role change and revision-matched no-op behavior. Membership changes and required audit commit atomically.
- [ ] Increment assignment/incarnation revisions correctly; stale role/remove forms including remove–rejoin fail safely after current authorization. No failed or unknown removal is shown as successful.
- [ ] Cancel inviter offers after lost grant power and refresh their evidence only if the precise grant power remains. Old tokens/jobs cannot gain new authority through rejoining or restoration.
- [ ] Preserve contributions and private artifacts; independent Shares remain available. Confirm named person/workspace/consequences with safe default focus and a separate authorized Share-review action.
- [ ] Test races on both databases, audit rollback, lost responses, admin capability loss clearing cached invitation data and successful leave/access-loss navigation.

Required proof: C06/C07/C22; F01/F03, plus the shared delivery rules above.

### Blocked by

Blocked by: W12

## W14 — Apply workspace roles to discussion and moderation

### Spec

docs/specs/m4.0-workspace-membership.md — §3–4, §9–10.

### What to build

Member+ discuss documents and manage their own contributions; Owner/Admin moderate without rewriting another person’s words.

### Acceptance criteria

- [ ] Apply registered actions and live resource predicates to comments/replies, own edits/deletes, reactions, fork, thread resolve/reopen and reanchor; Owner/Admin gain the specified any-thread/delete powers only.
- [ ] Keep versions, anchors, lifecycle and attribution rules; Viewer/former creator cannot write and removal cannot leave a stale mutation authorized.
- [ ] Scope mention searches and capability projections before pagination; no email inference, hidden audience or shared/member authority mixing.
- [ ] Update review controls and retained-draft denial/recovery states; prove every own/other-role branch and removal-versus-write ordering through the coordinator.

Required proof: C08/C19; F01, plus the shared delivery rules above.

### Blocked by

Blocked by: W05

## W15 — Apply workspace roles to approvals and suggestions

### Spec

docs/specs/m4.0-workspace-membership.md — §3–4, §9–10.

### What to build

Member+ approve under their own identity; document creators or Owner/Admin decide suggestions with existing version rules.

### Acceptance criteria

- [ ] Authorize own approval create/revoke and own-document versus any-document suggestion decisions through registered actions, current reach and protected commits.
- [ ] Preserve version pinning, suggestion state and anchor rules; never approve/revoke for another person or confuse document lifecycle with their approval.
- [ ] Update UI capability/recovery states, keep competing drafts, and test former-author Viewer, hidden/foreign resources and revocation ordering.
- [ ] Preserve exact-Share review behavior through shared services without widening its powers; generation of an AI draft never grants permission to apply it.

Required proof: C08; F01, plus the shared delivery rules above.

### Blocked by

Blocked by: W14

## W16 — Organize projects, document lifecycle, moves and Shares

### Spec

docs/specs/m4.0-workspace-membership.md — §3–4, §7–9.

### What to build

Members organize their own content and Owner/Admin manage workspace content while preserving document identity and review history.

### Acceptance criteria

- [ ] Replace project-create aliases with explicit workspace targets; implement own/any project updates and document lifecycle powers with capability-driven forms.
- [ ] Move own/any documents between same-workspace projects and Unfiled using expected placement revisions, current source/destination checks and sorted locks. Reject cross-workspace and ABA/stale moves.
- [ ] Manage document Shares according to document creator versus any-document powers, not the link creator; retain independent Share rules and safe projections.
- [ ] Preserve versions, comments, approvals and candidate lineage without copying documents. Test all roles/creators, hidden destinations, stale forms and Share-review navigation after member removal.

Required proof: C03/C08/C19, plus the shared delivery rules above.

### Blocked by

Blocked by: W05

## W17 — Import content with explicit workspace and source authority

### Spec

docs/specs/m4.0-workspace-membership.md — §3–4, §8–9.

### What to build

Member+ import public URL, paste and upload content; only Owner can use stored workspace credentials.

### Acceptance criteria

- [ ] Replace import/integration aliases and dependent validation/clients with explicit targets. Capture original grant/definition/placement/source evidence and operation generation through admission, external fetch and conditional result commit.
- [ ] Provide Owner-only integration controls and credential use; public imports by any role never silently pick up a stored PAT. Safe provenance exposes no credentials or secret-bearing URLs.
- [ ] Reject authenticated cross-scheme/host/port redirects before contacting the destination; preserve public SSRF/redirect and source identity checks.
- [ ] Use member/own-resource capability UI, current target disclosure and safe failure outcomes. Prove removal/revision changes before fetch and result, obsolete callbacks, queue failure and correct resource/audit placement.

Required proof: C03/C13/C14, plus the shared delivery rules above.

### Blocked by

Blocked by: W16

## W18 — Retry and re-sync using the original operation authority

### Spec

docs/specs/m4.0-workspace-membership.md — §3, §9.

### What to build

Authorized people explicitly retry or refresh a document while preserving last good content and rejecting obsolete worker results.

### Acceptance criteria

- [ ] Apply own/any retry and resync actions plus credential restrictions; recheck original authority, source and placement before external work and every success/failure commit.
- [ ] Use one active content-operation reservation and immutable generation; role/definition/source/move changes cancel rather than rebind old work.
- [ ] Retain Document/version/review identity and last good content on failure; old callbacks cannot clear or overwrite a replacement operation.
- [ ] Update polling, busy/stale/draft recovery and explicit restart behavior. Prove worker/redelivery and revocation overlaps on both databases with no external calls inside transaction retries.

Required proof: C07/C13, plus the shared delivery rules above.

### Blocked by

Blocked by: W17

## W19 — Replace pasted content without losing a competing draft

### Spec

docs/specs/m4.0-workspace-membership.md — §3, §9–10.

### What to build

An authorized editor creates a new version of pasted/uploaded content; a competing editor keeps their unsent changes.

### Acceptance criteria

- [ ] Reserve the shared active content-operation slot before modifying body/source and recheck current own/any authority and expected document state.
- [ ] Limit replacement to pasted/uploaded documents; linked content continues through resync. Preserve immutable versions, reanchoring and history.
- [ ] Return operation-in-progress/stale state without changing the competing draft; polling completion does not silently resubmit it.
- [ ] Prove concurrent edits, removal, lost committed responses and late callbacks through API and browser behavior.

Required proof: C08/C13/C18, plus the shared delivery rules above.

### Blocked by

Blocked by: W18

## W20 — Scan tracked repositories and publish complete paginated reports

### Spec

docs/specs/m4.0-workspace-membership.md — §3–4, §8–9.

### What to build

Authorized people preview/create/scan tracked sources and inspect a complete latest report with bounded processing.

### Acceptance criteria

- [ ] Replace tracked list/preview/create aliases and carry explicit workspace/source authority throughout. Member+ can use public sources; stored credentials still require Owner.
- [ ] Authorize own/any scan/delete without extending a tracked-repo creator’s power to unrelated documents found at the same path; redact inaccessible moved resources.
- [ ] Process large retained history in bounded database batches. Continue only classified recoverable file failures; stop on lost authority, unexpected errors or obsolete generation.
- [ ] Stage generation-pinned results, publish atomically and paginate complete reports. Retain prior good report during replacement/failure; backfill existing reports.
- [ ] Cover zero matches, source/DB errors, removal and stopped workers; bound memory/query growth and keep safe loading/partial/error/report states.

Required proof: C03/C14/C15/C19, plus the shared delivery rules above.

### Blocked by

Blocked by: W18

## W21 — Change tracked branches and filters without losing history

### Spec

docs/specs/m4.0-workspace-membership.md — §3, §8–9.

### What to build

A tracked-source owner or authorized administrator changes branch/path selection while existing documents keep their identity.

### Acceptance criteria

- [ ] Implement revision-checked source configuration and own/any capability UI, retaining Owner-only credential requirements.
- [ ] For retained repository/path matches, update source branch even when content is unchanged so future resync follows the new selection; missing/excluded documents remain retained.
- [ ] Invalidate obsolete scans/children/results through source revision and operation evidence; never quietly retarget previously admitted work.
- [ ] Test branch/filter ABA, unchanged content, retained comments/approvals/candidate lineage, concurrent scan/configuration and safe conflict recovery.

Required proof: C14/C15, plus the shared delivery rules above.

### Blocked by

Blocked by: W20

## W22 — Preserve anonymous demo import and claim only settled work

### Spec

docs/specs/m4.0-workspace-membership.md — §9.1.

### What to build

A demo visitor waits for import to settle, then explicitly claims into an authorized workspace; failed imports can be retried separately.

### Acceptance criteria

- [ ] Use narrowly scoped anonymous operation authority in the reserved system workspace; no synthetic user/membership, stored credentials, unrelated content or AI access.
- [ ] Claim only unexpired ready/failed documents with no active/pending/retrying content operation, using sorted source/destination guards and fresh destination claim/create authority.
- [ ] Active claim returns the specified 409 without any changes; UI waits/polls then enables an explicit Claim. Failed claim completion does not start Retry automatically.
- [ ] Invalidate anonymous authority after claim; duplicate success/failure/cleanup and stale prune selections cannot mutate/delete the claimed document.
- [ ] Provide critical real-worker regression tests for anonymous imports, active/failed/ready/expired claims, competing claims/prune and separate member Retry in a joined workspace.

Required proof: C17; F07, plus the shared delivery rules above.

### Blocked by

Blocked by: W18

## W23 — Bind Agent Tokens and MCP to live workspace membership

### Spec

docs/specs/m4.0-workspace-membership.md — §3–5, §8–9.

### What to build

Member+ mint a token for the selected workspace and its tools honor current role power; old incarnations never regain access.

### Acceptance criteria

- [ ] Replace token-create aliases and bind each token to exactly one workspace/membership incarnation. MCP scope resolution never uses personal-workspace fallback; reject ambiguous scope and mismatched resources.
- [ ] Intersect live role actions, token restrictions and existing supported tools on reads and protected writes. Do not add membership-management tools, REST bearer access or MCP cookie bypass.
- [ ] Keep caller-owned cross-workspace token list/revoke available after downgrade/removal with minimal historical labels; hide other users’ metadata and use safe one-time-secret recovery.
- [ ] Backfill valid legacy token bindings and revoke invalid ones. Test downgrade/rejoin, token-revoke/write races and all existing MCP surfaces without changing native protocol errors.

Required proof: C03/C07/C10, plus the shared delivery rules above.

### Blocked by

Blocked by: W05

## W24 — Unify six AI starts with workspace roles and private artifacts

### Spec

docs/specs/m4.0-workspace-membership.md — §3–4, §9.

### What to build

Member+ use the six existing AI tools through one admission flow; private artifacts remain actor-only even from Owner/Admin.

### Acceptance criteria

- [ ] Consolidate duplicate starts into one service while preserving six tools, input/readiness/version checks, provider gates, budgets/rate limits, deduplication, Ask exemption and output semantics.
- [ ] Capture original exact authority on admission and preserve it when joining a run; joining dispatches nothing and never upgrades authority.
- [ ] Apply Member+ generation and live actor-private reads; Viewer can read their own retained private artifact with current reach, but cannot generate.
- [ ] Update capability-driven controls, polling, action-specific draft application and safe errors. Prove all six endpoint paths with scripted providers; no prompt redesign or generic AI framework.

Required proof: C03/C08/C11/C22, plus the shared delivery rules above.

### Blocked by

Blocked by: W05

## W25 — Checkpoint AI calls through a complete Digest run

### Spec

docs/specs/m4.0-workspace-membership.md — §9.2.

### What to build

A chunked Digest reuses completed calls, fences provider execution and retries final publication without generating again.

### Acceptance criteria

- [ ] Implement the shared durable executor and exercise it end to end through Digest: bounded immutable input/model/prompt/schema plan, ordered unique calls and attempt fence committed before any provider request.
- [ ] Checkpoint validated results and idempotent spend receipts atomically; duplicate workers never replay completed/in-flight calls. Assemble from saved results and reauthorize publication.
- [ ] Permit bounded retry only with positive non-execution evidence; generic transient/5xx/timeout is insufficient. Inspect/constrain hidden SDK retries and stop uncertain execution without silently sending again.
- [ ] Preserve known spend/unknown total, allow late accounting without output resurrection, and scrub temporary input/prompt/result copies at terminal settlement. No checkpoint content leaks through serializers or logs.
- [ ] Prove chunk-one success/later-safe-retry, single-call-sized Digest, fence failure, process death, changed inputs/authority and publication-only retry using real workers/call counts. This shared executor is complete for this reference flow; remaining generators adopt it next.

Required proof: C11/C12, plus the shared delivery rules above.

### Blocked by

Blocked by: W24

## W26 — Use durable call recovery across all six AI tools

### Spec

docs/specs/m4.0-workspace-membership.md — §9.2, §10.

### What to build

Every generator follows the same safe-resumption contract and the user can distinguish saved progress from an uncertain interrupted run.

### Acceptance criteria

- [ ] Migrate the other five generators, including single-call paths, to the shared executor without output/prompt semantic changes; no generator can call around its fence.
- [ ] Prove immutable-input equivalence, original-initiator privacy, completed-call reuse, no regeneration on publication retry, refusal/invalid-output accounting and no automatic paid retry.
- [ ] Cover deaths before fence, after fence/before send, after provider acceptance and before checkpoint; duplicate workers, role loss and late receipts never revive output or scrubbed transcripts.
- [ ] Expose interruption and potential prior cost; explicit restart creates a new run under current authority. Private partial checkpoints never become user artifacts; empty-input paths preserve existing no-call behavior.
- [ ] Extend the real-worker crash matrix and browser recovery journey across relevant generator shapes. Ordinary migration settles legacy active runs without reliable evidence rather than inferring they were unsent.

Required proof: C11/C12/C22; F08, plus the shared delivery rules above.

### Blocked by

Blocked by: W25

## W27 — Settle abandoned work independently of browser traffic

### Spec

docs/specs/m4.0-workspace-membership.md — §9–9.2, §11.

### What to build

The scheduler settles revoked or abandoned imports, scans, demos and AI without a browser visit or functioning work queue.

### Acceptance criteria

- [ ] Run bounded indexed cleanup on the independent scheduler with configurable minute cadence and derived queue/execution/retry deadlines; legitimate active work is not reaped.
- [ ] Condition settlement on current operation identity and authority; retain last good content/report and known spend. Never restart uncertain AI work or transfer anonymous demo authority.
- [ ] Repair terminal AI content scrubbing, settle legacy jobs lacking trustworthy evidence and preserve encrypted invitation retry/generation rules.
- [ ] Prove dead worker, dead scheduler followed by recovery, DB failure, stale callbacks, healthy idle and demo-claim recovery. Emit safe heartbeat/outcome diagnostics without making optional telemetry transactional.

Required proof: C12/C17/C20/C21, plus the shared delivery rules above.

### Blocked by

Blocked by: W13, W20, W22, W26

## W28 — Expose independent operational checks and recovery guidance

### Spec

docs/specs/m4.0-workspace-membership.md — §11.

### What to build

Operators can distinguish healthy idle from stalled queue, cleanup and protected writes using checks outside the monitored processes.

### Acceptance criteria

- [ ] Provide secret-free read-only checks for invitation queue age, overdue operations, cleanup heartbeat and exhausted lock budgets; optional Nightwatch remains optional.
- [ ] Wire existing operator monitoring independently of worker/scheduler. Use the specified configurable thresholds: three missed cleanup beats, two intervals beyond deadline, five-minute oldest mail, five consecutive minute contention samples.
- [ ] Distinguish unavailable checks from healthy idle and correlate safe lifecycle events without tokens, email/private payloads or raw requests. Monitoring failure cannot block access reduction.
- [ ] Document diagnosis and ordinary fix-forward/compatible-build recovery for both editions; demonstrate stopped workers/scheduler and recovery. Add no maintenance mode, fleet gate, forced drain or rollback-floor framework.

Required proof: C20/C22, plus the shared delivery rules above.

### Blocked by

Blocked by: W27

## W29 — Verify the complete workspace boundary and ordinary deployment

### Spec

docs/specs/m4.0-workspace-membership.md — Testing Decisions; §11.

### What to build

The assembled foundation is ready to release with complete resource authorization, verified migration and real operational smoke evidence.

### Acceptance criteria

- [ ] Reconcile every registered action, affected endpoint/tool and accepted engineering/design requirement to implementation tests. Run the full four-role/own-other/two-workspace matrix and all 30 test-map groups; this ticket supplies no missing feature tests.
- [ ] Run fast suites, required real-database/worker CI and browser journeys with no skipped required scenarios; inspect mobile/desktop, both themes, four locales, keyboard, 320px/200% zoom and long names against the approved design.
- [ ] Verify migration/backfill/repair on supported modes, removed aliases, private legacy assets, token/job/report behavior and matching web/API builds. Preserve review identity and document compatible-build/fix-forward recovery.
- [ ] Perform ordinary deployed invite/receive/verify/accept/review/remove, worker/scheduler, private-origin and proxy-redaction smoke checks; clearly retain outstanding external checks if deployment access is unavailable.
- [ ] Confirm existing-account verification recovery tracked by #156 before final acceptance. No automatic mailbox verification or maintenance/fleet-control system; temporary deployment disruption remains accepted.

Required proof: C01–C22; F01–F08, plus the shared delivery rules above.

### Blocked by

Blocked by: W08, W15, W19, W21, W23, W28, #156

## Coverage ownership

| Contract | Primary ticket owners |
|---|---|
| C01 catalogs | W02 |
| C02 lifecycle | W02, W12, W13 |
| C03 explicit target | W05, W16–W18, W20, W22–W24 |
| C04 durable offers/mail | W09, W10 |
| C05 acceptance | W12 |
| C06 administration | W13 |
| C07 coordinator/races | W03 and every writer adoption |
| C08 resource matrix | W14–W19, W23, W24 |
| C09 exact Share | W06 |
| C10 MCP/token | W23 |
| C11/C12 AI calls/accounting | W24–W27 |
| C13 content jobs | W17–W19 |
| C14 credentials/source | W17, W20, W21 |
| C15 scans/reports | W20, W21 |
| C16 private media | W07, W08 |
| C17 demo | W22, W27 |
| C18 errors/recovery | W04, W11 and affected UI slices |
| C19 queries | W05, W14, W20 |
| C20 operations | W10, W27, W28 |
| C21 migrations | W02, W07, W08, W20, W23, W26, W27 |
| C22 privacy | W04–W06, W09–W13, W23–W28 |
| F01 invite/review/remove | W09, W12–W15 |
| F02 account recovery | W11, W12; external #156 |
| F03 administration | W13 |
| F04 context/unknown writes | W04, W05 and each form |
| F05 invitation states | W09, W10, W12 |
| F06 independent Share | W06–W08, W13, W16 |
| F07 demo claim | W22, W27 |
| F08 AI recovery | W25, W26 |

W29 verifies all owners’ evidence together. The test map remains **0/30 certified**
for the new contract until implementation actually supplies passing evidence.

## Publication record

Published 2026-10-01 after the user requested another attempt with updated session
permissions. Earlier blocked attempts created nothing. The GitHub CLI successfully
created parent #160, all 29 native sub-issues and all 40 native dependency edges;
read-back verification matched every canonical Blocked by line, parent relation,
label and child checklist. No body-only relationship fallback was needed.

The reviewed spec is pinned by commit in each issue. Planning documents and this
publication record are published on `docs/workspace-membership`; remote `main` is
unchanged. Runtime implementation, the required tests and visual QA remain pending.
M4.0 is ticketed; M4.1 still needs its separate rebase.

Initial frontier: #161 (W01), #162 (W02), #164 (W04). Recommended first ticket:
#161, the real-database/worker profile. Work one ticket per session with `$implement`.
Issue #156 blocks only the final acceptance ticket #189.

## Published issue mapping

| Planning ID | GitHub issue | Blocked by |
|---|---|---|
| W01 | [#161](https://github.com/batjaa/kedge/issues/161) | None |
| W02 | [#162](https://github.com/batjaa/kedge/issues/162) | None |
| W03 | [#163](https://github.com/batjaa/kedge/issues/163) | #161, #162 |
| W04 | [#164](https://github.com/batjaa/kedge/issues/164) | None |
| W05 | [#165](https://github.com/batjaa/kedge/issues/165) | #163, #164 |
| W06 | [#166](https://github.com/batjaa/kedge/issues/166) | #163, #164 |
| W07 | [#167](https://github.com/batjaa/kedge/issues/167) | #166 |
| W08 | [#168](https://github.com/batjaa/kedge/issues/168) | #167 |
| W09 | [#169](https://github.com/batjaa/kedge/issues/169) | #165 |
| W10 | [#170](https://github.com/batjaa/kedge/issues/170) | #169 |
| W11 | [#171](https://github.com/batjaa/kedge/issues/171) | #161, #164 |
| W12 | [#172](https://github.com/batjaa/kedge/issues/172) | #170, #171 |
| W13 | [#173](https://github.com/batjaa/kedge/issues/173) | #172 |
| W14 | [#174](https://github.com/batjaa/kedge/issues/174) | #165 |
| W15 | [#175](https://github.com/batjaa/kedge/issues/175) | #174 |
| W16 | [#176](https://github.com/batjaa/kedge/issues/176) | #165 |
| W17 | [#177](https://github.com/batjaa/kedge/issues/177) | #176 |
| W18 | [#178](https://github.com/batjaa/kedge/issues/178) | #177 |
| W19 | [#179](https://github.com/batjaa/kedge/issues/179) | #178 |
| W20 | [#180](https://github.com/batjaa/kedge/issues/180) | #178 |
| W21 | [#181](https://github.com/batjaa/kedge/issues/181) | #180 |
| W22 | [#182](https://github.com/batjaa/kedge/issues/182) | #178 |
| W23 | [#183](https://github.com/batjaa/kedge/issues/183) | #165 |
| W24 | [#184](https://github.com/batjaa/kedge/issues/184) | #165 |
| W25 | [#185](https://github.com/batjaa/kedge/issues/185) | #184 |
| W26 | [#186](https://github.com/batjaa/kedge/issues/186) | #185 |
| W27 | [#187](https://github.com/batjaa/kedge/issues/187) | #173, #180, #182, #186 |
| W28 | [#188](https://github.com/batjaa/kedge/issues/188) | #187 |
| W29 | [#189](https://github.com/batjaa/kedge/issues/189) | #168, #175, #179, #181, #183, #188, #156 |
