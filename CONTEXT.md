# Kedge

Spec-review platform: documents are imported from wherever they live, rendered,
and reviewed with comments that survive new versions. One context — this is the
ubiquitous language for specs, code, and tickets.

## Language

### Tenancy & organization

**Workspace**:
The tenancy boundary. Every person gets a personal one; every document,
credential, and audit record belongs to exactly one.
_Avoid_: team, org, account

**Project**:
An organizational container inside a workspace that documents attach to
(post-v1). A project is what you're working on, not where content lives — it
can mix documents from many sources, and one repo can feed many projects.
_Avoid_: repo (a repo is a Source), folder, collection

**Reference**:
A context link attached to a project or document — an issue, a discussion, an
external page (post-v1). Rendered as a link, never imported, never anchorable.
_Avoid_: attachment, linked document

### Content & versions

**Source**:
Where a document's content comes from: a repo file, a raw URL, pasted content,
a Confluence page. Every document has exactly one.
_Avoid_: origin, upstream, integration

**Tracked Repo**:
A workspace-owned record — repo URL + ref + path pattern — that Kedge scans on
demand to discover and import matching files into a project (pinned 2026-07-21).
Tracked means remembered and re-scannable, not watched: pull-based (manual
Re-scan) until the M6 App webhook drives the same record. Documents it imports
keep their own file-level Source; the tracked repo is provenance and refresh
machinery, never the container.
_Avoid_: repo source (a Source is file-granular), watcher, sync agent

**Connector**:
The code that knows how to fetch from one kind of source and (later) post back
to it.

**Document**:
The stable identity of one reviewable text at one source — the thing people
share, discuss, and approve. Its content changes only by gaining versions.
_Avoid_: file, page, spec (a spec is what the document contains)

**Document Version**:
An immutable snapshot of a document's content, created by import or re-sync,
deduplicated by content hash. Anchors, approvals, and diffs bind to versions.
_Avoid_: revision, snapshot

**Candidate Version**:
A proposed next version of an existing document, originating from a pull
request (or any pre-merge state of its source). Reviewed like any version;
when the proposal merges, comments re-anchor into the document's lineage.
A PR is never a separate document. (See ADR 0001.)
_Avoid_: PR doc, branch copy, draft document

**Projection**:
A version's plain-text rendering-derived substrate that anchors bind to. One
pipeline defines what a document *is* for both reading and anchoring.
_Avoid_: plain text (ambiguous), extraction

### Access & review

**Integration**:
A workspace's stored credential for a private source (today: a GitHub PAT).
Credentials are never shown after connect.
_Avoid_: connection, token (the token is the secret inside it)

**Share**:
An unguessable, revocable link granting read-only access to one document. The
token is shown once; possession of it grants exactly that document.
_Avoid_: public link, invite

**Reviewer**:
Someone who reviews a shared document without a full account — a passwordless,
non-member identity, verified by magic link and bound to one Share. Reviews
(reads, comments, suggests) exactly that document, nothing else.
_Avoid_: guest, member (a Reviewer is neither)

**Share Participant**:
The binding that makes a Reviewer's capability real: a verified (Reviewer, Share)
pair. Every reviewer action resolves through a participant row on an active
(non-revoked, non-expired) share — distinct from Workspace membership.
_Avoid_: member, collaborator

**Agent**:
A non-human reviewer acting over MCP under a member's Agent Token. Reads and
comments through the same Policies as a human, is always badged as an agent,
and never approves or changes lifecycle — no tool for those exists.
_Avoid_: bot, AI reviewer (the AI drafting features are not an Agent)

**Agent Token**:
The named, revocable, workspace-scoped credential a member mints for one Agent.
Shown exactly once at creation, listed with its last-used time, revoked
instantly. Usable only on the MCP surface — every REST v1 action rejects it, so
an Agent can never reach a human-only action or mint another token.
_Avoid_: API key, PAT (a PAT is the GitHub credential inside an Integration)

**Demo Document**:
An anonymously imported document living in the reserved system workspace with
an expiry, viewable through its share, claimable into a real workspace
(SaaS only).
_Avoid_: guest doc, trial doc

**Import Warning**:
A per-version record of what didn't survive normalization (failed image, dropped
construct) — always shown to the author, never silent.

### AI

**AI Run**:
One queued AI generation with its cost ledger — type, status, model, tokens,
cost — over exactly one document. Append-only history: a retry mints a new run,
so a failed run keeps its error and spend forever and AI cost/day survives
retries. Output is always a draft a human confirms, never an action.
_Avoid_: job (a job executes a run), generation, request

**Improve-the-doc Prompt**:
The copyable AI artifact an author pastes into a coding agent to get the
revision the review asked for — unresolved feedback grouped by section,
accepted suggested edits included verbatim as required edits, quoted anchors.
Rendered server-side from the database; the model contributes only one
instruction per thread.
_Avoid_: improve prompt run (it is the artifact of an AI Run, type
improve_prompt), doc prompt
