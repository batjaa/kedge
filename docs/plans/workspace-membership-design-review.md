# Workspace membership — design plan review

> Completed 2026-09-27 · Design-plan review only; no runtime UI changes.
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
| 1 — information architecture | 6/10 | 10/10 | Complete: written requirements; runtime QA pending |
| 2 — interaction states | 8/10 | 10/10 | Complete: written requirements; runtime QA pending |
| 3 — journey | 7/10 | 10/10 | Complete: written requirements; runtime QA pending |
| 4 — intentional app UI | 8/10 | 10/10 | Complete: written requirements; runtime QA pending |
| 5 — design-system alignment | 8/10 | 10/10 | Complete: written requirements; runtime QA pending |
| 6 — responsive/accessibility | 6/10 | 10/10 | Complete: written requirements; runtime QA pending |
| 7 — unresolved decisions | Unscored | — | Complete: D1A–D4A accepted; none unresolved |

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
utility rearrangement is specified in Pass 6. This updates module spec
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
D3A/D4A below settle workspace-switch navigation and invite-form presentation.

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

D3A/D4A complete the remaining navigation/form choices; the final pass ratings
and rationale are recorded below.

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

## Accepted D4A — contextual invite dialog and mobile sheet

User selected D4A on 2026-09-27. Invite member opens a compact dialog over Members/
Invitations, becoming a full-height sheet below `sm`. Invitation acceptance remains
a distinct page reached from the emailed link. The dialog keeps one recipient,
Member default, permitted roles, readable scope disclosure and explicit Send invitation.

The spec now defines focus entry/containment/restoration, pristine versus dirty
closing, and unknown/pending-send recovery. Closing a dialog cannot cancel a server
mutation. Validation/enqueue failure keeps input; duplicate pending offers do not
claim another email was sent. Confirmed new offers move to the Invitations row.
Existing dialog styling is reusable, but the inspected `AiArtifactDialog` does not
itself trap focus; that behavior must be supplied/tested for the new form.

## Pass 1 — information architecture

**6/10 → 10/10 for written completeness.** D1A–D4A settle the genuine presentation
choices. Remaining hierarchy follows the accepted product scope. A 10 requires a
clear first/second/third level on every affected surface, including the role inspector
and invitation landing; the module spec now states those levels explicitly.

```text
App header: Kedge + named workspace | permitted navigation | personal identity
  Workspace selection -> selected workspace Documents/home (D3A)
  Workspace settings
    General / permitted source and agent controls
    Members (D2A)
      Heading + Invite member (authorized) + secondary View roles
      Members | Invitations (authorized; pending count)
      Selected list filters -> rows -> pagination
      Invite member -> compact dialog / full-height mobile sheet (D4A)
        Workspace -> Email -> Role -> access summary -> Cancel / Send
      View roles -> read-only role selection + grouped capability explanation
Emailed invitation -> safe standalone offer
  Workspace/inviter -> offered role + scope -> account state -> explicit Join
```

Read-only role detail uses the existing dialog/sheet vocabulary; inline expansion
inside Invite avoids stacking modals. It remains driven by server definitions rather
than browser role hierarchy. The three highest-priority pieces are where you are,
who has/will gain access, and the next permitted action. No account, team or project
membership navigation is introduced by old preview mockups.

## Pass 2 — interaction-state coverage

**8/10 → 10/10 for written completeness.** A 10 needs visible loading, empty, error,
success and partial states for every feature, not only backend status categories.
The canonical §10 table covers nine feature groups: switcher, directory, invitations,
invite form, role inspector/change, remove/leave, acceptance, demo claim and AI recovery.
No independent product choice remains in this pass.

Key state decisions already follow the accepted contract:

- The Owner row remains visible in a one-person workspace; “It's just you here” is
  guidance alongside that row, not an inaccurate empty directory.
- No pending invitations, no filtered matches and a failed list are different states.
  Only authorized administrators see invitation counts, recipients and actions.
- Confirmed enqueue, transport acceptance and uncertain delivery use different copy.
  Duplicate pending submission points to the existing offer rather than promising mail.
- Dirty dismissal protects input; closing while sending does not imply cancellation.
  Unknown writes provide explicit reconciliation, never an automatic submit loop.
- Stale role/remove forms retain intent and need fresh review. Permission loss clears
  cached invitation/admin-email details and offers only currently permitted navigation.
- Scheduled/AI recovery keeps the original authority; uncertain provider work stops,
  preserves honest cost status and requires an explicit new run. No partial AI artifact
  is represented as a completed result or silently posted.

These are necessary UI expressions of the accepted engineering outcomes, not new
retry, persistence or permission policies. No new offline/localStorage draft system.

## Pass 3 — journey and emotional arc

**7/10 → 10/10 for written completeness.** A 10 gives the inviter and recipient an
understandable, recoverable path without requiring knowledge of generations, grants
or queues. Emotions below are design hypotheses, not claims of user research.

| Step | User does | Likely concern | Design support |
|---|---|---|---|
| 1 | Opens Members in a workspace | “Am I inviting into the right place?” | Persistent named workspace, page context and named form heading |
| 2 | Enters email and chooses role | “What can this person see or change?” | Member default, permitted choices, role explanation, all-projects/Unfiled disclosure |
| 3 | Sends invitation | “Did it work?” | Sending then truthful queued status; recoverable error/uncertainty with retained input |
| 4 | Opens received link | “Who invited me, and what am I joining?” | Workspace/inviter/role/scope before identity steps, no resource preview |
| 5 | Signs in/registers/verifies | “Will I lose the invitation?” | Validated return to the same offer; account mismatch explained; no automatic acceptance |
| 6 | Explicitly joins | “What can I do now?” | Joined workspace home, role confirmation, permitted controls; no forced tour |
| 7 | Returns and switches workspaces | “Where am I working?” | Named selector always opens destination home; personal identity stays distinct |
| 8 | Changes role/removes/leaves | “What happens to work and access?” | Person/workspace/consequences named; history preserved and independent-share exception explicit |
| 9 | Encounters stale/unknown outcome | “Could retrying do the wrong thing?” | Preserve intent, check current state, explicit reviewed resubmission |

First five seconds: recognizable Kedge chrome and an unambiguous workspace/task.
First five minutes: a successful invite/accept/review path with clear role meaning.
Long-term use: stable navigation, truthful status, preserved attribution and consistent
recovery build trust. Avoid celebratory screens, aspirational prose and repeated scope
warnings in every row; put scope/consequences at the relevant decision point.

## Pass 4 — intentional interface, not generic decoration

**8/10 → 10/10 for written completeness.** Classify this as APP UI / Operate, with
Read mode on existing document surfaces. This is not a marketing redesign. A 10
requires concrete layout/copy choices and no generic dashboard decoration.

The spec now uses a named selector, compact settings navigation, one selected list,
readable rows and a short contextual invite form. No member-card mosaic, centered
feature pitch, decorative icon circles, gradient or illustrated empty-state hero.
Existing Open Harbor panels are functional containers; the user's explicit design
system overrides generic skill objections to panels or system body fonts.

| Litmus check | Result and rationale |
|---|---|
| Product unmistakable? | YES: existing Kedge branding/chrome, not a new landing page |
| Strong visual anchor? | YES: page/form title with visible workspace context |
| Headline scan understandable? | YES: Members, Invitations, Invite to workspace and Join workspace |
| One job per section? | YES: selected directory/offer list; short mutation form; standalone acceptance |
| Cards necessary? | YES only for existing functional panel/dialog containers; no decorative grid |
| Motion improves hierarchy? | NO additional motion needed; state/focus handles orientation |
| Works without decorative shadows? | YES: typography, spacing and existing rings establish hierarchy |

No new decorative motion is required to improve a settings workflow. Keep reduced
motion and existing transition behavior; no unrelated restyle is part of this work.

## Pass 5 — design-system alignment

**8/10 → 10/10 for written completeness.** A 10 maps the new surfaces to actual
DESIGN.md tokens/anatomy, including their exceptions; the spec does so without adding
new tokens or replacing the system. DESIGN.md is Markdown, not a structured token
object, so section/token names below identify the actual source.

| Existing DESIGN.md definition | Application here |
|---|---|
| Typography: Space Grotesk display; system UI/body | Page/dialog titles inherit display face; fields/rows use existing body/UI stack; no runtime font fetch |
| Color: stone-50 / zinc-900 page, white / white-[.03] panel | Existing workspace/settings and dialog surfaces in both themes |
| Shape/elevation: rounded-2xl panels, hairline rings | One functional list/form surface; existing dialog geometry; no repeated per-person cards |
| Buttons: human primary zinc/light and emerald/dark | Send/Join/save actions; not AI violet |
| Status chips: textual mono metadata and limited hues | Roles, offer lifecycle and delivery status; readable consequences stay body text |
| Interaction: emerald focus; reduced motion | New selector, navigation, disclosures, dialogs and action controls |
| Agent action register | Only existing AI generate/retry controls; invitation and role actions stay human |

Read-only role inspection explains `own` versus broader management and Owner-only
source credentials accurately. It does not reduce authority to a colored hierarchy
badge or expose PHP/action identifiers as user-facing explanations. Existing localized
catalogs own copy. No design-system exception needs approval.

## Pass 6 — responsive and accessibility

**6/10 → 10/10 for written completeness.** A 10 needs explicit viewport behavior,
keyboard/focus semantics and long-content handling. The module now specifies desktop,
tablet and below-`sm` arrangements, plus 320px/200%-zoom/long-localized-copy verification.
These are planned requirements, not a browser or contrast audit already performed.

Desktop keeps bounded rows and permitted navigation. Tablet reduces secondary chrome
first. Mobile preserves the logo, named workspace trigger and personal identity;
secondary utilities move into the personal menu, while workspace selection remains
separate per D1A. Member/invitation rows become labeled stacks without horizontal
scrolling. Both view labels remain reachable; Settings does not disappear merely
because the previous desktop Settings link hid below `sm`.

Dialog/sheet controls have at least 44px interactive areas, accessible names, focus
containment, inert background, Escape, sensible entry/return focus and keyboard-visible
focus. Dirty and sending states cannot silently discard or claim cancellation. Mobile
uses dynamic viewport/safe-area sizing and a reachable action footer above the software
keyboard. Critical scope/error copy is readable body text, not tiny metadata.

URL-addressable tabs use navigation semantics unless implementing a full tab keyboard
pattern. Labels persist after entry; field errors are associated and announced; status
updates do not steal focus. Owner protection, selection and errors are never color-only.
Long names/email/localized strings wrap or truncate with an accessible full value;
new controls remain usable without hover, drag or swipe. Verify both themes and
reduced motion. Reuse existing typography density deliberately rather than applying
a generic all-text size rule that contradicts DESIGN.md.

## Pass 7 — unresolved decisions

D1A dedicated workspace selector, D2A Members/Invitations tabs, D3A destination home
and D4A contextual invite dialog/mobile sheet are accepted and reconciled across the
canonical spec, design system, roadmap and test map. No new unresolved design choice
or independent debt deferral emerged in the remaining passes.

Dismissal, confirmation copy, role inspection and responsive/focus behavior are
necessary details within those choices and existing privacy/permission/recovery
requirements. They do not add features from the old Teams preview. There is no new
TODO for missing accessibility or empty states: those are required implementation
work, recorded below and in the canonical spec.

## Implementation tasks

These extend the engineering tasks, not a second ticket tree. Test references are
from the [implementation test map](workspace-membership-test-map.md).

- [ ] **D-T1 (P1)** — App shell — add the dedicated named workspace switcher and home routing.
  - Surfaced by: D1A/D3A and Pass 6; context must stay visible at every supported width.
  - Files: app shell, workspace discovery/context clients, navigation and personal-menu utilities.
  - Verify: F04 plus single/long/duplicate-name lists, list/page/navigation failures,
    current-row no-op, original form targets and mobile/keyboard access.
- [ ] **D-T2 (P1)** — Settings — implement Members/Invitations views and permission-specific states.
  - Surfaced by: D2A and Passes 1–2; separate lists need independent navigation and truthful outcomes.
  - Files: workspace settings pages, list/filter components, clients and localized catalogs.
  - Verify: F01/F03/F05, role-dependent navigation/counts/email projection, deep links,
    empty/filter/error states, narrow rows and permission loss while details are visible.
- [ ] **D-T3 (P1)** — Invitation/admin forms — implement the responsive dialog and confirmation pattern.
  - Surfaced by: D4A and Passes 2/6; existing dialog code is not sufficient proof of form accessibility.
  - Files: invite/role/remove/leave components, shared appropriate dialog/sheet primitive,
    role inspector and localized strings.
  - Verify: focus containment/restoration, inert background, dirty/pending close,
    software keyboard, stale/unknown responses, no automatic replay or email leakage.
- [ ] **D-T4 (P1)** — Invitation landing — implement the explicit join/account-recovery journey.
  - Surfaced by: Pass 3; the recipient must understand the offer and return safely from auth.
  - Files: public invitation page, auth-return integration, acceptance client and localized strings.
  - Verify: F01/F02/F05; masked preview, verified matching identity, wrong account,
    return-without-auto-accept, inactive link and confirmed joined-home destination.
- [ ] **D-T5 (P1)** — UI verification — prove the complete state matrix and responsive interactions.
  - Surfaced by: Passes 2/5/6; written contracts are not rendered evidence.
  - Files: existing/new Playwright journeys and shared accessibility/visual fixtures.
  - Verify: F01–F08, both themes, 320px/narrow/tablet/desktop, 200% zoom, long localized
    content, keyboard-only operation and reduced motion. Record rendered evidence
    during implementation; this planning review does not claim visual QA passed.

## Completion summary

| Dimension | Before → after written-plan fixes |
|---|---|
| System audit | Existing Open Harbor system reused; new membership UI explicitly scoped |
| Step 0 | 6/10 overall; full seven-pass review within accepted scope |
| Information architecture | 6 → 10 |
| Interaction states | 8 → 10 |
| Journey | 7 → 10 |
| Intentional app UI | 8 → 10 |
| Design system | 8 → 10 |
| Responsive/accessibility | 6 → 10 |
| Decisions | Four independently presented choices accepted; zero unresolved/deferred |
| NOT in scope / existing patterns | Written; original exclusions retained |
| TODOS | Completion recorded; no new independent deferral |
| Overall completeness (lowest pass) | 6 → 10 for written requirements |

The plan is design-complete. Scores describe explicit written decisions and required
verification, not visual polish or proven usability of an application that has not
been built. Implementation still requires the specified rendered/accessibility QA.
Next: reconcile the unpublished project ticket structure onto the reviewed workspace
foundation; no tracker publication or runtime implementation occurred in this review.

## NOT in scope

- New branding, typography or component-system replacement: use approved Open Harbor.
- Account/billing hierarchy, team management or new workspace creation: excluded by
  the accepted foundation, despite the post-v1 mockup showing them.
- Custom-role editing and direct project membership UI: separate future scope.
- Runtime implementation, live browser QA or ticket publication: this pass improves
  the design plan; implementation and publication have their own next steps.

## Unresolved decisions

None. All four choices are accepted; rendered UI verification remains implementation work.
