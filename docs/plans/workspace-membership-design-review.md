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
| 1 — information architecture | 6/10 | — | D1A accepted; 7/10 interim, D2 pending |
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

**Pass 1 interim rating: 6/10 → 7/10.** Workspace orientation is settled. Members/
invitations organization is still undecided; no completed-pass rating claimed.

## Pending D2 — Members screen organization

The spec §10 requires separate paginated members and invitation lists, but does
not define whether both occupy the same view. That matters because all members
can inspect the directory, while only Owner/Admin may inspect invitations.
Current `web/app/(app)/settings/page.tsx` stacks General, Integrations and Agent
Tokens; appending two long member lists to that stack would bury the task.
The existing post-v1 teams preview mixes Members/Teams and does not settle this.

Both options give Members a dedicated destination within workspace settings,
reuse the existing settings styling and keep invitation controls/counts restricted
to authorized roles. This does not change any role powers or introduce Teams.

**D2A (recommended):** one Members page with “Members” and “Invitations” tabs;
Members is the default, and Owner/Admin get the Invitations tab with a pending
count and a persistent “Invite member” action. Member/Viewer see the directory
without a disabled/locked invitation tab. Separate URL-addressable list state keeps
filters and pagination from interfering. Moderate specification effort now; avoids
long mixed lists and keeps each view focused on one task.

**D2B:** one Members page with Members and Invitations as two stacked sections,
each with its own filters/pagination; unauthorized users see only the directory.
Slightly simpler structure, with an at-a-glance admin overview, but invitation
management moves below the member list as the workspace grows.

```text
D2A — proposed                    D2B — alternative
Workspace / Settings / Members    Workspace / Settings / Members
Members          [Invite member] Members          [Invite member]
[Members] [Invitations (3)]       Member filters + rows + pagination
Filters + one list + pagination   Invitations: filters + rows + pagination
```

Recommendation follows hierarchy-as-service and one job per section. Deferring
this choice risks implementing either two competing paginators or a hidden invitation
workflow accidentally. Neither option is recorded as accepted yet.

## Implementation tasks so far

- [ ] **D-T1 (P1)** — App shell — add the dedicated named workspace switcher.
  - Surfaced by: D1A; workspace context must be distinct from personal identity.
  - Files: `web/components/app/app-shell.tsx`, workspace discovery client and shared
    context/navigation consumers; responsive shell utilities after Pass 6.
  - Verify: existing workspace-context journey F04 plus keyboard open/select/Escape,
    single/long/duplicate-name lists, failed pagination and access loss; no draft
    retargeting or late-response cross-workspace rendering.

## NOT in scope

- New branding, typography or component-system replacement: use approved Open Harbor.
- Account/billing hierarchy, team management or new workspace creation: excluded by
  the accepted foundation, despite the post-v1 mockup showing them.
- Custom-role editing and direct project membership UI: separate future scope.
- Runtime implementation, live browser QA or ticket publication: this pass improves
  the design plan; implementation and publication have their own next steps.

## Unresolved decisions

- D2: tabs versus stacked lists on the Members page.
- Remaining passes are not yet reviewed; no completion or visual approval claimed.
