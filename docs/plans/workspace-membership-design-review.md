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
| 1 — information architecture | 6/10 | — | D1 pending |
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

## Pending D1 — workspace switcher placement

Evidence: module spec §8 calls for “a workspace switcher in the app shell” and a
visible current workspace on creation/admin forms, without fixing placement.
`app-shell.tsx:31–84` contains personal identity/actions but no workspace selector.
The old `app-teams.html:25` explicitly describes an “avatar menu open, showing the
Account → Workspace switcher”; that preview also assumes excluded account features.
Neither source settles the new foundation's navigation choice.

**D1A (recommended):** dedicated named workspace switcher beside the Kedge logo;
personal identity stays distinct. It makes the current work context visible and
switching discoverable. Small effort to specify now; mobile header space needs an
intentional responsive arrangement in Pass 6.

```text
kedge | Platform workspace v | Documents ... | personal identity
        [current workspace]
        [other joined workspaces]
        [personal workspace]
```

**D1B:** workspace switching inside the avatar/account menu, with the current
workspace still named persistently in the app chrome. One consolidated menu uses
less navigation space, but users must learn that a personal identity control also
changes workspace context. Small effort to specify now.

Both preserve explicit target URLs, personal identity, role capabilities and the
rule that switching cannot retarget an open form. Do not introduce account grouping,
workspace creation or a new global sidebar through this choice. Deferring placement
risks divergent controls across dashboard, settings and review pages. D1A follows
hierarchy-as-service: workspace identity should be visible where workspace actions
are performed. No option is recorded as accepted yet.

## NOT in scope

- New branding, typography or component-system replacement: use approved Open Harbor.
- Account/billing hierarchy, team management or new workspace creation: excluded by
  the accepted foundation, despite the post-v1 mockup showing them.
- Custom-role editing and direct project membership UI: separate future scope.
- Runtime implementation, live browser QA or ticket publication: this pass improves
  the design plan; implementation and publication have their own next steps.

## Unresolved decisions

- D1: dedicated workspace switcher versus avatar-menu switching.
- Remaining passes are not yet reviewed; no completion or visual approval claimed.
