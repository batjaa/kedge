# Project access — planning brief

> 2026-09-26 · Status: synthesized into the [module spec](../specs/m4.1-project-access.md).
> This brief preserves the original planning recommendations. The module spec
> supplies draft defaults for its open choices and the user-agreed testing seams;
> engineering/design review is pending. The recommendations were not separately
> confirmed by the user.

## Destination

An owner can invite someone by email to a project. After accepting, that person
can find the project and use its documents within their assigned role, without
gaining access to the rest of the workspace. Owners can see pending invitations,
change roles, and remove access. The design must later support invitations to a
whole workspace without replacing project memberships or creating new accounts.

Project access is being pulled forward from the original post-v1 scope at the
user's request. Workspace membership management remains a later expansion.

## What exists and what must change

- Workspace owner/member records exist, but the app primarily selects the
  caller's personal workspace. Project, document, and tracked-repo list/create
  controllers assume that workspace. Adding a membership row alone cannot make
  someone else's project usable.
- The project page resolves its project from the personal-workspace project
  list. Invited-project discovery and a directly authorized project read are
  part of this module, not a follow-up.
- Document shares and magic-link reviewers already exist. They grant access to
  individual documents and do not constitute project membership.
- Some document/thread/comment author permissions deliberately survive loss of
  membership. Project removal must address these paths explicitly; simply
  deleting a project membership will not be enough.
- Source operations use workspace-owned integrations. Project membership must
  not accidentally expose credentials or allow arbitrary private-repo imports
  under the owner's GitHub authority.
- AI runs and MCP currently assume workspace membership; MCP credentials also
  impose their own workspace scope. Human project access must not silently
  broaden agent access.

Code entry points: `ProjectController`, `DocumentController`,
`TrackedRepoController`, `AuthorizesWorkspaceMembership`,
`ResolvesShareReviewers`, `AiRunPolicy`, and `web/app/(app)/projects/[id]/page.tsx`.

## Proposed first release

One medium-to-large vertical module: **Project access**. Its demo is an owner
inviting a second account into Kedge's own documentation project, that account
reviewing a document, and the owner removing its access. The invitee cannot see
an unrelated project, Unfiled documents, workspace settings, or integrations.

### Roles — first open decision

Recommended starting set:

| Capability | Viewer | Reviewer | Maintainer |
|---|---|---|---|
| Read project documents, versions, diffs, and review discussions | Yes | Yes | Yes |
| Comment, suggest edits, approve; manage own review contributions | No | Yes | Yes |
| Triage reviews and manage project documents | No | No | Yes |
| Manage project details and invitations | No | No | Yes |
| Manage workspace settings, credentials, or workspace membership | No | No | No |

The workspace owner retains project administration. There is no independent
project ownership transfer in this release. Default invite role: Reviewer.
The Reviewer project role is distinct from the existing magic-link Reviewer
identity; UI and domain language must make that distinction explicit.

"Manage documents" needs a full action matrix before implementation: lifecycle,
content replacement, import/retry/re-sync, moves, source configuration, share-link
creation, moderation, and AI use must each have an explicit rule. A generic
`isMember` permission cannot represent a read-only Viewer.

### Invitation and membership experience

- A **Members** entry on the project opens current members and pending invites.
  Invitation form: email and role, with a clear statement that access covers this
  project's current and future documents. Show the workspace owner as inherited
  administration, not a removable project seat.
- Send an email with the project name, inviter, role, expiry, and acceptance
  link. Pending rows support resend and revoke; members support role changes and
  removal. Delivery failure must have a visible retry path.
- New users register and confirm their email; existing users sign in. Preserve
  the destination through both flows. Acceptance requires the invited, verified
  email and an explicit action; merely opening the link changes no access and
  logs nobody in. Handle the wrong signed-in account clearly.
- Existing magic-link reviewer identities use the account-upgrade flow with
  fresh mailbox proof. An invitation never silently converts a document-review
  session into a full account session.
- Show accepted projects under **Shared with you**, labelled with their owning
  workspace. The user's personal workspace remains intact. Entering a project
  changes the visible project context; it does not grant workspace-wide browsing.
- Use the existing Open Harbor components, light/dark themes, keyboard patterns,
  and four supported UI locales. Include empty, sending, pending, accepted,
  expired, revoked, wrong-account, denied, and load-failed states.

### Access boundary and workspace expansion

Recommended model: keep workspaces as the ownership/tenancy boundary and add
explicit project memberships for narrower grants. Do not insert a workspace
membership as a side effect of accepting a project invitation.

Keep project and workspace membership records explicit, with database uniqueness
and referential integrity. Share invitation lifecycle logic between scopes;
avoid building a generic permissions framework or introducing teams/accounts.
The implementation spec will choose the concrete invitation schema and endpoints.

Policies should resolve capabilities from the resource's owning workspace and
current project. Lists and counts must apply the same access rules at the
database, including versions, threads, mentions, activity, source reports, and
AI artifacts. Return capabilities with resources so UI controls follow the API.
Never use an invitee's personal workspace to store imported project documents or
select the project's integration.

Later, a workspace invitation adds workspace membership to the same user. The
same acceptance experience can support either scope. Recommended inheritance:
effective capabilities combine workspace-derived and direct project grants;
project roles do not silently restrict a broader workspace grant. Removing one
grant leaves any other explicit grant intact, and the Members screen should
explain where access comes from. Exact workspace roles and private-project
exceptions remain a later decision, not implied promises of this release.

### Removal, document moves, and existing share links

Recommended rule: authorship preserves attribution, not a perpetual right to
access or mutate a project. Re-check current access on each request and at the
commit point of sensitive writes. Removal/role changes must also cover cached
capabilities, polling, queued user-initiated work, and requests already in flight.
Retain historical comments and approvals; do not erase someone's review history.

Documents inherit access from their current project, including historical
versions. Moving a document changes its audience and must be treated as an
access change. Recommended first-release boundary: only the workspace owner
can move documents between projects or to/from Unfiled; no cross-workspace move.
Preserve the relationship between a tracked repo and its imported documents so
later scans cannot move content across an access boundary accidentally.

Existing document share links remain independent grants. Removing project
membership cannot revoke a bearer link someone already possesses. The final
spec must define the removal copy and share-management permissions, including
whether a Maintainer can create new shares. It must not promise complete access
revocation while an independent document share still grants access.

## Remaining decisions, in order

1. **Role set** — Viewer / Reviewer / Maintainer is recommended; alternatives
   are Reviewer / Maintainer or one full collaborator role.
2. **Maintainer authority** — exact document/moderation/invitation actions;
   whether maintainers may appoint peers. Recommend owner-only changes to
   Maintainer seats and owner-only cross-project moves initially.
3. **Source authority** — recommend that only the workspace owner connects
   credentials or authorizes a new private repo/path/ref. Maintainers may
   re-scan already authorized sources. Broader source setup needs an explicit
   delegation model so project access cannot consume arbitrary workspace PAT
   permissions. Public/paste/upload imports need their own explicit rule.
4. **AI and agents** — decide whether project roles can read shared AI artifacts
   or spend the owner's AI budget. Keep per-actor drafts private. Recommend
   leaving new project-scoped MCP tokens for later and preserving all existing
   token scope checks; inviting a human grants no new agent authority.
5. **Grant interactions** — approve the removal/authorship rule, document move
   semantics, and how independent share access is explained to the owner.
6. **Invitation lifecycle** — recommend seven-day expiry, one pending invitation
   per normalized email/project, resend replacing the token, and idempotent
   acceptance. Decide what changing or removing an inviter does to pending
   invitations; acceptance must never activate authority the inviter has lost.

## Delivery outline and verification seams

Proposed vertical slices for the eventual spec/tickets, not implementation tasks
approved by this brief:

1. **Invite and open a project:** narrow membership, owner invitation/acceptance,
   verified-account flows, Shared with you, authorized project/document reads.
2. **Review within a role:** the agreed capability matrix across documents,
   versions, comments, suggestions, approvals, and all corresponding controls.
3. **Administer access:** Members screen, pending invite resend/revoke, role
   changes/removal, audit trail, and the agreed source/share/move rules.

Authorization foundations and denial tests ship with every slice. Do not expose
an invitation path until its reachable actions are fully constrained.

- PHPUnit: role/action matrix; project A versus project B in the same workspace;
  another workspace; Unfiled; direct IDs and list/count/mention leaks; revoked
  members with authored content; invitation replay/expiry/email mismatch;
  concurrent acceptance, revocation, and downgrade; source-credential boundaries;
  existing document-share and MCP scope regression coverage.
- Playwright: owner invites, second account accepts, finds and reviews the
  project, cannot access another project, then loses access after removal.
  Include an existing-account invite and a new-account confirmation journey.
- Mail and UI: queued mail failure/retry, translated member/invite states,
  keyboard operation, mobile, both themes. Tests fake delivery; deployment
  verification confirms a real invitation email is deliverable.
- Migrations: existing personal workspaces/projects keep working without fake
  invitations or bulk project-member backfills; explicit indexes on membership
  and invitation lookup/join columns; additive API rollout before web.

After the decisions are resolved: synthesize an implementation spec with
`$to-spec`, review engineering and UI flows, then split into tracer-bullet tickets.
Workspace invitations/management, teams, billing, SSO, and project-scoped agent
tokens are outside this first module.
