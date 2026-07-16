# Spec: Comments & suggestions

> Module M2 on `docs/ROADMAP.md`. Scope source: SPEC §21 M2; threads & anchoring SPEC §8; reviewer identity SPEC §10.2; transactional mail SPEC §12; schema SPEC §16. Language: CONTEXT.md. Specced 2026-07-15.

## Problem Statement

Kedge can import, render, and share a document — and then the conversation about it happens somewhere else. A reviewer reading a beautifully rendered spec has no way to say anything: no comment on a paragraph, no proposed wording, no way for the author to see what reviewers think, agree on changes, or triage feedback. The product's entire reason to exist — anchored review conversations that survive versions — has its substrate (every version carries a projection) but no conversation on top of it.

## Solution

The review conversation, on every document surface. A reviewer opens a share link, verifies with a magic link (one email, no password), selects text, and comments — or proposes a concrete rewording as a suggestion. Authors reply, resolve, fork off-topic tangents into their own threads, and accept or decline suggestions. Threads hang in the review rail from the approved design — sticky, aligned to their anchors, with a document header and TOC that finally make long specs navigable. Drafts survive reloads; comments post exactly once; a reviewer who arrived through a share can reach exactly that document and nothing else.

## User Stories

1. As a reviewer, I want to select text and start an inline thread on it, so that my feedback points at exactly the words I mean.
2. As a reviewer, I want to start a document-level thread, so that feedback about the whole doc has a home too.
3. As a reviewer arriving via a share link, I want to identify with a magic link (email in → click link → I'm attributed), so that I never create a password for a one-off review.
4. As a reviewer, I want my identity scoped to the share I came through, so that possessing one link never becomes broader access (SPEC §10.2).
5. As a reviewer, I want to propose a suggested edit — my replacement text for the selected passage — rendered as a before→after diff, so that agreement is concrete, not vibes.
6. As an author, I want to accept or decline each suggestion, so that decisions are recorded on the thread (accepted ones feed the M4 improve-prompt verbatim).
7. As a participant, I want to reply in threads with markdown, so that review conversations read like conversations.
8. As an author or thread creator, I want to resolve and reopen threads, so that finished conversations get out of the way honestly.
9. As an author, I want to fork any reply into its own new thread (inheriting the anchor, linked both ways), so that off-topic tangents don't bury the original question.
10. As a participant, I want to `@mention` someone in a comment, so that attention can be directed (delivery of mentions beyond the page is M5).
11. As a participant, I want to edit and delete my own comments, and react 👍 to others, so that "+1" noise becomes a count instead of a reply.
12. As a reviewer, I want my unsent draft to survive a reload (local persistence), so that a long comment is never lost to a stray navigation.
13. As a reviewer, I want submitting a comment to be idempotent (double-click, flaky network), so that nothing ever posts twice.
14. As a reader, I want the review rail from the approved design — sticky, thread cards aligned to their anchors, a Threads group in the sidebar — so that conversation and text sit side by side (spike finding, TODOS 2026-07-03).
15. As a reader, I want a sticky document header and TOC with scroll-spy on long docs, so that I always know where I am (folds in issue #51).
16. As an author, I want to see all threads including ones whose anchors will someday orphan — the Orphaned tray exists as a surface from day one (empty until M3 re-anchoring populates it).
17. As an author or workspace owner, I want to resolve or delete anything on my document, so that moderation is possible; reviewers manage only their own.
18. As a reviewer on a busy doc, I want threads and comments paginated at the database, so that a 200-thread document stays fast.
19. As a security reviewer, I want comment persistence to never depend on any downstream delivery (mail, future notifications) — the comment is saved first, always (hard rule).
20. As an operator, I want thread/comment/suggestion activity in the audit log and named events, so that a posting bug is reconstructable from logs alone.

## Implementation Decisions

**Builds on M0+M1**: auth, workspaces, Policies, shares, projection substrate (`plain_text` + `projection_version` on every version), the hardened render pipeline, the journey-pack e2e infrastructure.

**Schema (M2 slice of SPEC §16).** `threads` (document-scoped; type inline|document; status open|resolved; `forked_from_comment_id`), `comments` (type comment|suggestion; `body_md`; `proposed_text`; `suggestion_status` pending|accepted|declined; `client` web|mcp — populated `web` only until M4; edit/delete own), `anchors` (per thread × document version: `exact`/`prefix`/`suffix`, `start`/`end`, `heading_path`, `projection_version`, state anchored|relocated|orphaned — only `anchored` is ever written in M2), reactions (👍 only), plus the backed enums for every fixed-value column. Comment bodies render through the same sanitized pipeline as documents (SPEC §6.1) — a comment is untrusted input like everything else.

**Anchor capture is web-owned and pure at its core.** Selection → selector happens in the browser against the version's projection: the selection maps to projection offsets (`start`/`end`), captures `exact` with ~64 chars of `prefix`/`suffix` context and the `heading_path`, and stamps the version's `projection_version`. The mapping logic is a DOM-agnostic pure core (rendered-node ↔ projection-offset correspondence, placeholder tokens are unselectable and unspannable) so it is golden-corpus-testable; the thin DOM layer feeds it real Selections. Anchors bind to the document's current version at creation. **Re-anchoring is explicitly M3** — the hypothes.is ladder, `relocated`/`orphaned` transitions, and re-attach UI are out; M2 ships the anchor format, capture, and rendering of anchored threads.

**Reviewer identity: magic links, share-scoped.** The share page offers "verify your email to comment": a signed, short-lived, single-use link delivered by transactional mail (SPEC §12 — log driver in dev/e2e, SMTP self-host, Postmark SaaS; this module introduces the mail dependency, nothing more — the notification system is M5). Verification creates or reuses a lightweight user (no password) and binds it to that share; Policies resolve every reviewer capability through that binding, so cross-share or cross-document traversal is structurally impossible (the IDOR matrix grows its reviewer-via-share column across every action). Anonymous commenting stays off by default with a per-share toggle (SPEC §10.2). Rate-limited like all auth surfaces.

**Threads live on claimed documents only.** Demo Documents (CONTEXT.md) don't accept threads until claimed — there is no author to triage and they expire; the claim CTA is the path to a conversation. (Decision made here; SPEC §10.3 silent on it.)

**Suggestions.** A suggestion is a comment carrying `proposed_text` for its thread's anchored selection, rendered as an inline before→after diff. The document author sets `suggestion_status`; accepted text is stored verbatim for the M4 improve-prompt. No write-back to the source, ever (SPEC non-goal).

**Fork.** Promotes a reply into a new thread: inherits the source thread's anchor by default, records `forked_from_comment_id`, renders bidirectional "forked from / forked into" links.

**The reading + review surface.** The review rail per `docs/designs/review-page.html`: sticky, cards vertically aligned to their anchor positions (degrading gracefully when they crowd), highlight-on-hover both directions, a Threads group in the sidebar, and the sticky doc header + TOC with scroll-spy (issue #51). Same surface on the authenticated doc page and the share page, differing only by capability. All Tailwind + DESIGN.md tokens; no webfonts.

**Drafts & idempotency.** Unsent drafts persist in localStorage keyed by document/thread/anchor context. Submission carries a client idempotency key; the API dedupes on it; the submit control disables in flight (SPEC §8.1).

**Pagination & events.** DB-level pagination for threads and comments. Named events (`thread.created`, `comment.created`, `suggestion.accepted/declined`, `thread.resolved/forked`) + audit-log entries; comment persistence precedes and never depends on any fan-out.

## Testing Decisions

Extends the three established seams (agreed 2026-07-15); the journey-pack philosophy applies.

1. **API HTTP seam (PHPUnit).** Thread/comment/suggestion lifecycle over the API (create inline + document threads, reply, resolve/reopen, fork with anchor inheritance, suggestion accept/decline as author-only), magic-link issuance + verification with mail faked at the transport (assert the mailable, never send), share-scoped reviewer Policies — the IDOR matrix's largest extension: reviewer-via-share × (read/comment/suggest/resolve/fork/accept/moderate/other-doc/other-share) — plus pagination, idempotency-key dedupe, rate limits, and comment-persists-when-mail-fails.
2. **Web pipeline seam (Vitest).** A golden selection→selector corpus for the pure anchor-capture core, mirroring the projection corpus: fixture (projection, selection range) → expected `{exact, prefix, suffix, start, end, heading_path}`; edge cases around placeholder tokens (unselectable, unspannable), selections spanning formatting boundaries, heading-path derivation, and the suggestion before→after diff rendering. Comment-body sanitization rides the existing MDX adversarial suite.
3. **E2E journey pack (3–4 new specs).** Reviewer journey: open share → request magic link → capture it from the log-driver mailbox → verified → select text → comment appears in the rail. Suggestion journey: propose → author accepts → status visible. Author triage journey: reply, fork from a reply, resolve; rail + TOC navigation asserted along the way. Real browser Selection APIs are exercised only here, on the fixture docs; unique users/docs per spec, zero retries, M0/M1 journeys untouched.

Good tests assert external behavior: what the API returns, what persists, what renders in the rail — never capture internals. Prior art: every convention above already exists in the suite; the new corpus follows `web/test`'s golden-fixture pattern.

## Out of Scope

- **Re-anchoring** (exact→fuzzy→orphan ladder, `relocated`/`orphaned` transitions, re-attach UI, matcher timeout budget) — M3, gated on the anchoring spike. M2 writes only `anchored` anchors; the Orphaned tray renders empty.
- **Notifications** (inbox, reply/mention/resolution emails, digests, prefs) — M5. This module sends exactly one kind of mail: the magic link.
- **AI features and MCP** (digest, reply drafts, split, summaries, agent-authored comments) — M4. The `client` column and agent-badge rendering slot exist; nothing populates `mcp`.
- **`email_restricted` / `workspace` share modes** — unblocked by magic-link identity but not in the M2 milestone; schedule when needed (SPEC §10.2 note).
- **Approvals & lifecycle UI** — M3.
- **Realtime** — polling/refresh semantics in v1; Reverb later.
- **Raw comment sync-back to the source** — post-v1 (digest post-back is M6).

## Further Notes

- Demo criterion (SPEC §21 M2): *a full review conversation including an accepted suggestion, in two browsers.* The reviewer + suggestion journeys automate exactly this.
- The anchoring **spike remains M3's gate, not M2's**: the anchor format is pinned (SPEC §8.2) and capture binds to one version; the spike validates re-anchoring across versions. If the spike later demands a selector-format amendment, `projection_version`/migration machinery (SPEC §5.4) is the escape hatch.
- Issue #51 (sticky doc header + TOC) is deliberately folded into this module's reading-surface work; close it when the rail ships.
- Comment bodies are a prompt-injection channel for M4's AI features (SPEC §13) — nothing to build now, but the sanitized-pipeline decision above is what makes that posture possible later.
- First module whose reviewer flows touch mail: the self-host story needs only `MAIL_MAILER=smtp` (already env-pluggable); the preview instance can use the log driver until Launch provisions Postmark.
