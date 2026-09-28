# Workspace membership — design plan review

> Started 2026-09-27 · In progress; planning only, no runtime UI changes.
> Target: [M4.0 workspace membership](../specs/m4.0-workspace-membership.md).
> Engineering decisions 1A–7A remain accepted; design decisions use the D prefix.

## Scope and initial assessment

The user's “move on” continues the next named step after engineering review:
workspace design review, followed by unpublished ticket reconciliation. Review all
seven dimensions within the accepted scope. Do not reopen role powers, all-projects
visibility, independent-share removal semantics or the ordinary deployment model.

**Initial overall completeness: 6/10**, the lowest dimension, not an average.
The spec already describes permission-driven actions and failure recovery. A complete
design plan additionally needs exact navigation, screen hierarchy, role-specific
empty states, invitation and removal copy, mobile behavior and keyboard/focus rules.
This is a rating of written planning detail, not a visual rating of an implemented UI.

| Pass | Initial | Final | Status |
|---|---|---|---|
| 1 — information architecture | 6/10 | — | D1A/D2A accepted; 8/10 interim, D3 pending |
| 2 — interaction states | 8/10 | — | Pending |
| 3 — journey | 7/10 | — | Pending |
| 4 — intentional app UI | 8/10 | — | Pending |
| 5 — design-system alignment | 8/10 | — | Pending |
| 6 — responsive/accessibility | 6/10 | — | Pending |
| 7 — unresolved decisions | Unscored | — | Pending |

## What already exists

[DESIGN.md](../DESIGN.md) is authoritative: Open Harbor, Space Grotesk for display,
system body/UI fonts, light/dark stone/zinc surfaces, emerald focus/primary register,
hairline rings, existing panel geometry and localized utility copy. These explicit
choices override generic skill preferences for different fonts or card treatment.
Violet remains reserved for AI controls; membership actions are human actions.

- `web/components/app/app-shell.tsx`: sticky header with Kedge branding, document
  navigation, locale/theme/import controls, Settings link, avatar/email and sign-out.
  The avatar is intentionally visible at every width; Settings is hidden below `sm`.
- `web/app/(app)/settings/page.tsx`: existing heading, personal-workspace chip,
  General, Integrations and gated Agent Tokens panels; currently personal-only.
- `workspace-general-card.tsx`, `document-shares.tsx`, `agent-tokens-panel.tsx`:
  existing form, destructive-action and credential patterns to inspect/reuse where
  their behavior meets the new contract; no claim that they already implement all
  required error/permission states.
- Existing auth forms and mobile thread sheet: reuse the application's language,
  focus/keyboard patterns and narrow-screen presentation where appropriate.
- `docs/designs/app-workspace.html`: style reference, but Members is a future ghost.
  Its outdated copy and workspace-deletion control do not expand current scope.
- `docs/designs/app-teams.html`: post-v1 preview with account grouping, teams and an
  avatar switcher. Reuse visual vocabulary selectively; accounts, billing and teams
  are not part of the workspace-membership foundation.

## Surface inventory

| Surface | User goal | New design detail needed |
|---|---|---|
| App header/workspace switcher | Operate: know/select working context | Placement, current selection, long names, pagination/search and mobile access |
| Workspace settings navigation | Operate: reach permitted settings | General/Members/roles/invitations hierarchy and role-based visibility |
| Members/invitations | Operate: invite/administer or inspect directory | Row content, primary action, filtering, empty/loading/partial states |
| Role inspector/invite/change/remove/leave | Operate: understand and confirm scope | Form/dialog presentation, precise consequences, focus and stale outcomes |
| Invitation landing/auth return | Operate: understand offer and join explicitly | Identity/workspace hierarchy, matched/mismatched account and recovery copy |
| Existing resource/review surfaces | Read and Operate | Workspace orientation, capability changes, retained draft/access-loss behavior |
| Demo claim and AI interruption | Operate: finish or recover existing task | Waiting/explicit claim, safe resumption versus uncertain new-run action |

## Accepted D1A — dedicated workspace switcher

User selected D1A on 2026-09-27. Place a named workspace switcher beside the Kedge
logo, with personal identity separate. Keep the named control visible on mobile;
exact utility rearrangement is still reviewed in Pass 6. This updates module spec
§8/§10 and DESIGN.md; the old avatar-menu preview is not the selected navigation.

Evidence: module spec §8 previously said only “a workspace switcher in the app shell.”
`app-shell.tsx:31–84` contains personal identity/actions but no workspace selector;
`app-teams.html:25` described an avatar/account switcher for a different post-v1 scope.

```text
kedge | Platform workspace v | Documents ... | personal identity
        Platform workspace  [selected]  Member
        Other workspace                 Viewer
        Personal workspace  [Personal]  Owner
```

Carry the accepted choice through long names, matching names, paginated lists,
loading/error states, keyboard focus and access loss. The current page/context
remains truthful while the list loads or fails. None of these states adds an
account group, workspace-creation action or automatic form retargeting.

D1A settled workspace orientation; D2A below settles Members/invitations organization.
The pass remains in progress until workspace-switch navigation is specified.

## Accepted D2A — Members and Invitations tabs

User selected D2A on 2026-09-27. Members has a dedicated workspace-settings destination
with Members as the default view and an Invitations tab for Owner/Admin. The tab has
a pending count, and authorized administrators have a persistent Invite member action.
Member/Viewer see the directory without inaccessible invitation controls or counts.
Lists have independent, workspace-scoped, URL-addressable filter/pagination state.

Evidence: spec §10 required separate paginated lists without settling their layout.
The existing settings page stacks General, Integrations and Agent Tokens; appending
two long lists would bury the member/invitation task. Tabs were selected over stacked
lists for focused navigation as the workspace grows. Neither role powers nor scope
changes with this choice.

```text
Workspace / Settings / Members
Members                         [Invite member]
[Members] [Invitations (3)]      (Owner/Admin only)
Selected list filters
Selected list rows
Pagination
```

The canonical spec now includes heading/action/list hierarchy and concrete loading,
owner-only membership, empty-invitation, filtered-empty, failed-page and permission-
loss states. A failed count is not zero; losing administrative power removes cached
invitation/email details. Owner-only membership still displays the Owner row, not
an inaccurate “no members” illustration. Role details remain secondary/read-only.

**Pass 1 interim rating: 6/10 → 8/10.** Location and list organization are concrete;
workspace-switch destination is still unspecified. Other pass scores are unchanged
until those passes are completed, even where this decision adds useful state detail.

## Pending D3 — destination after selecting another workspace

The spec §8 fixes explicit targets and forbids retargeting an open submission, but
it does not say which page selecting another workspace opens. The accepted D1A
selector makes this a routine user action. A document/project belongs to a particular
workspace; keeping its resource ID while replacing the workspace would be incorrect.
Workspace-wide pages such as Members do have a meaningful counterpart elsewhere.

**D3A (recommended):** selecting another workspace opens its Documents/home page
consistently. This gives one predictable place to orient to the new workspace;
people administering several workspaces need an extra navigation step back to Members.
Small specification effort; avoids navigation behavior depending on the previous page.

**D3B:** retain the equivalent workspace-wide section when permitted (for example,
Members → Members), falling back to the new workspace home for document/project-
specific pages or unavailable sections. This saves repeat navigation for administrators
but needs a clear mapping and fallback states. Moderate specification effort now.

Both keep form targets/drafts bound to their original workspace and preserve the
existing access-loss behavior. Switching does not submit or copy a form, remap a
project/document by name, or change another tab's target. Invitation acceptance
already opens the joined workspace and is not reopened by this decision. Nor does
this decide a new sign-in landing preference or change stable personal identity.

D3A is recommended for predictable orientation, not to save refactoring effort.
Deferring this choice risks inconsistent behavior between settings and document
views. No destination option is accepted yet.

## Implementation tasks so far

- [ ] **D-T1 (P1)** — App shell — add the dedicated named workspace switcher.
  - Surfaced by: D1A; workspace context must be distinct from personal identity.
  - Files: `web/components/app/app-shell.tsx`, workspace discovery client and shared
    context/navigation consumers; responsive shell utilities after Pass 6.
  - Verify: existing workspace-context journey F04 plus keyboard open/select/Escape,
    single/long/duplicate-name lists, failed pagination and access loss; no draft
    retargeting or late-response cross-workspace rendering.

- [ ] **D-T2 (P1)** — Workspace settings — build the Members/Invitations navigation and list states.
  - Surfaced by: D2A; independently paginated directories and offers need a clear hierarchy.
  - Files: workspace settings pages, member/invitation clients and list components,
    role/capability projections, localization catalogs.
  - Verify: F01/F03/F05 plus role-dependent navigation/counts, deep links/back/refresh,
    separate filters/cursors, Owner-only membership, empty/error states and loss of
    admin authority while invitation details are displayed.

## NOT in scope

- New branding, typography or component-system replacement: use approved Open Harbor.
- Account/billing hierarchy, team management or new workspace creation: excluded by
  the accepted foundation, despite the post-v1 mockup showing them.
- Custom-role editing and direct project membership UI: separate future scope.
- Runtime implementation, live browser QA or ticket publication: this pass improves
  the design plan; implementation and publication have their own next steps.

## Unresolved decisions

- D3: new workspace home versus equivalent-section navigation after switching.
- Remaining passes are not yet reviewed; no completion or visual approval claimed.
