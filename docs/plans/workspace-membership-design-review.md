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
| 1 — information architecture | 6/10 | — | D1A–D3A accepted; D4 form presentation pending |
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
D3A below settles workspace-switch navigation; invite-form presentation is next.

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
D3A below completes switch destination. Invite-form presentation is the remaining
information-architecture choice. Other pass scores remain unfinalized until reviewed.

## Accepted D3A — switching opens the destination home

User selected D3A on 2026-09-27. Selecting another workspace always opens its
Documents/home page, including when switching from Members, Invitations, other
settings, a project or a document. Do not map the current section/resource into the
new workspace. Selecting the current workspace is a dismissal/no-op, not a page reset.

The previous spec fixed authorization/target identity but omitted destination behavior.
D3A was selected over retaining equivalent sections for predictable orientation.
Administrators may need another click to return to Members; this is an accepted
interaction tradeoff, not a refactoring-cost compromise.

During navigation, show loading for the new destination instead of old rows under
a new label. A failed navigation keeps the prior confirmed context or shows the
explicit destination error, depending on whether navigation committed. Access loss
uses the existing personal-workspace recovery action and never silently opens a
third workspace. Pending forms, in-flight mutations and later confirmations retain
their original target; another tab's workspace does not change. This does not alter
invitation acceptance, valid auth returns or choose a new default after sign-in.

```text
Current workspace / Members      -- select Platform --> Platform / Documents
Current workspace / Project X    -- select Platform --> Platform / Documents
Current workspace / Document Y   -- select Platform --> Platform / Documents
Current workspace / any page     -- select current  --> same page (no reset)
```

## Pending D4 — presentation of the invitation form

The accepted Members page has an Invite member action, and the spec defines one
recipient email, a permitted role with Member default, role explanation and the
all-projects/Unfiled disclosure. It does not yet define where this form opens.
That choice determines navigation context, focus/dismissal and mobile presentation.
Invitation acceptance remains its own link-addressable page under both options.

Existing app patterns support either direction: General settings and share creation
are inline forms, while AI panels use dialog/sheet shells. Reuse their visual
vocabulary, but do not assume existing dialogs meet every form accessibility need:
`ai-artifact-dialog.tsx` restores focus/Escape but does not itself trap focus, while
`mobile-thread-sheet.tsx` has an explicit focus trap. Required focus containment and
draft protection remain implementation work whichever form presentation is selected.

**D4A (recommended):** Invite member opens a compact dialog over the current Members
view, with a full-height sheet on narrow screens. Email, role, access summary and
Send invitation stay in one short form. Moderate effort to specify focus/dismissal;
keeps the directory context and avoids a separate navigation step.

**D4B:** Invite member opens a dedicated invitation form page within workspace
settings, with a clear Back to Members link. More space and a stable navigation
surface, but an extra page transition for a short task. Similar specification effort;
no modal focus/dismissal complexity.

Both offer one recipient, preserve the selected workspace and draft on failed
submission, show only assignable roles and require explicit Send invitation.
No bulk invite, automatic resend or role editing is introduced. D4A is recommended
because the task is short and starts from the directory; deferring it leaves engineers
to invent overlay/navigation behavior. Neither option is accepted yet.

## Implementation tasks so far

- [ ] **D-T1 (P1)** — App shell — add the dedicated named workspace switcher.
  - Surfaced by: D1A/D3A; workspace context is distinct from personal identity and
    every switch has one predictable destination.
  - Files: `web/components/app/app-shell.tsx`, workspace discovery client and shared
    context/navigation consumers; responsive shell utilities after Pass 6.
  - Verify: existing workspace-context journey F04 plus keyboard open/select/Escape,
    single/long/duplicate-name lists, failed pagination and access loss; switching
    from settings/project/document always opens destination home; selecting current
    is a no-op; no draft retargeting or late-response cross-workspace rendering.

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

- D4: contextual dialog/mobile sheet versus dedicated invitation form page.
- Remaining passes are not yet reviewed; no completion or visual approval claimed.
