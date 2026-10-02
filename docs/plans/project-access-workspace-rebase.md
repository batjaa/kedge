# Project access — workspace foundation rebase map

> Updated 2026-10-01 · Workspace tickets published; project reconciliation remains a draft.
> Baseline: [M4.0 workspace spec](../specs/m4.0-workspace-membership.md) and
> [29-ticket workspace breakdown](workspace-membership-tickets.md).

The old [27-ticket project draft](project-access-tickets.md) preserves reviewed
requirements but is no longer the publication plan. Common authorization, execution,
delivery and operational machinery belongs in M4.0. M4.1 extends that foundation
with direct project grants, project-only discovery and owner-approved repository
delegation. Do not implement the old foundation tickets a second time.

## Old ticket disposition

T IDs below refer to the unpublished project draft; W IDs refer to the published workspace
breakdown. “Reuse” still requires project-specific adapters and regression tests.

| Old project ticket | Workspace foundation destination | Remaining M4.1 behavior |
|---|---|---|
| T01 visual design review | D1A–D4A already settle workspace surfaces | Review project Members, Shared with you, combined access and repository approvals |
| T02 consolidate AI starts | W24; W25/W26 add the accepted durable-call contract | Project Reviewer/Maintainer generation permissions and exact grant evidence |
| T03 integration profile | W01 | Add project grant/delegation races and journeys to the same profile |
| T04 mutation coordinator | W03 and writer adoptions | Compose project evidence and two-project move checks through the same coordinator |
| T05 sign-out | W11 | Reuse verified-recipient/project invitation return flow |
| T06 credential redirect boundary | W17 | Recheck selected Repository Approval before delegated fetch/commit |
| T07 bounded scans/reports | W20/W21 | Scope reports/retained history to project guests and delegated repositories |
| T08 private images | W07 | Add direct-project authority to delivery, without public-origin bypass |
| T09 private diagrams/legacy assets | W08 | Add direct-project authority; do not repeat legacy migration |
| T10 project invite/send/preview | W09 shared lifecycle/delivery/UI patterns | Separate project offer/grant persistence; Reviewer default; project-only disclosure |
| T11 resend/revoke | W10 shared generation and delivery rules | Project ceilings, current inviter evidence and project-specific offer projection |
| T12 accept/discover | W12 common recipient/account lifecycle | Activate only a direct project grant; Shared with you without sibling workspace exposure |
| T13 roles/leave/remove | W13 common lifecycle/revision patterns | Viewer/Reviewer/Maintainer assignment; direct-grant changes and remaining baseline access |
| T14 comments/mentions | W14 business services | Project action assignments, guest mention audience and chosen-grant races |
| T15 approvals/suggestions | W15 business services | Reviewer own approval; Maintainer suggestion decisions; version/attribution preserved |
| T16 Maintainer moderation | W16 and W14 | Project-wide Maintainer powers regardless of content creator; no rewriting others’ comments |
| T17 Shares/moves | W16 | Maintainer Share management and authority at both project endpoints; baseline composition |
| T18 public/paste import | W17 | Project-targeted guest import; no synthetic workspace membership |
| T19 resync | W18 | Exact initiating project grant and source approval evidence |
| T20 replace content | W19 | Maintainer any-document editing through existing reservation/recovery behavior |
| T21 private Repository Approval | W17 supplies credential boundary only | New Owner-approved per-project repository delegation, lifecycle and UI |
| T22 delegated tracked scans | W20 | Approval-scoped private sources, guest reports and revalidation before child dispatch/commit |
| T23 branches/path filters | W21 | Maintainer configuration bounded by current approved repository and project authority |
| T24 project AI powers | W24–W26 | Reviewer Ask/reply versus Maintainer all six, private artifact reach and original grant selection |
| T25 cleanup | W27 | Include revoked project grants and Repository Approvals; no new cleanup subsystem |
| T26 operational checks | W28 | Add project/delegation classifications to the same checks and safe events |
| T27 final verification | W29 proves workspace release only | Separate project matrix/journeys/release proof; reuse resolved #156 evidence where still relevant |

## Retained project product contracts

- Direct Viewer/Reviewer/Maintainer roles, Reviewer-default invitations and full
  verified-account acceptance. A project grant never creates workspace membership.
- Maintainers administer Viewers/Reviewers; only the workspace Owner appoints or
  manages Maintainers under the earlier accepted project decision. Self-leave
  affects only the direct grant.
- Maintainers moderate project content, manage Shares and move between projects
  where they have sufficient authority. Another person's words and approvals remain
  protected. Workspace baseline authority composes additively.
- Reviewers can use Ask and reply drafts; Maintainers can use all six AI tools.
  Private artifacts still require the same actor and current document reach.
- Private repository delegation is explicitly approved by the workspace Owner for
  the project. Workspace Admin status alone does not grant credential use or approval.
- Direct project removal preserves contributions, independent Shares and any
  independent workspace grant. Rejoining cannot revive old tokens/jobs/offer evidence.

## Required rebase work before project ticket publication

1. Replace “workspace membership follows later” and broad membership checks with
   the actual M4.0 catalogs, lifecycle and capability contracts. Define explicit
   project action assignments and revisions through the same resolver, without
   hierarchy, synthetic membership or duplicated policies.
2. Resolve project administrative ceilings against the new workspace roles.
   The earlier project decision names Owner and Maintainer; it does not establish
   that every workspace Admin can administer direct project grants. Carry Owner-only
   Maintainer appointment forward unless the user changes it; make any remaining
   Admin/Member delegation choice explicit instead of inferring it from a role name.
3. Describe effective access and origin when a person has both grants. A workspace
   Viewer plus direct Maintainer gains project powers; a workspace Member plus direct
   Viewer retains Member powers. Removal/leave copy must explain remaining access,
   and the roster must not imply that direct membership is the complete audience.
4. Define project-only discovery and navigation alongside the workspace switcher.
   Guests must not obtain workspace directory, projects, Unfiled, totals, source
   credentials or sibling search results. Workspace-wide views retain their baseline.
5. Reconcile move checks with M4.0: workspace Members can already move their own
   documents through Unfiled, Owner/Admin can move any, and direct Maintainers gain
   the approved two-project permission. A project role cannot subtract the baseline.
6. Specify deterministic sufficient-grant evidence for composite actions and queued
   work. Record the selected authority at admission and never substitute another
   grant after revocation. Add Repository Approval revisions and exact repository
   identity without changing M4.0's Owner-only credential default.
7. Review project-specific visual states, revise the project test map, and produce
   narrow end-to-end tickets for the remaining behavior. Reuse workspace error,
   invitation, coordinator, private-media, AI, cleanup and monitoring services.

These are rebase tasks, not newly approved project powers. No new project decision
is needed to approve the workspace breakdown; M4.0 already leaves the extension
seams open. The project spec and its historical review remain rebase-pending.

## Publication state

M4.0: [parent #160](https://github.com/batjaa/kedge/issues/160) and 29 native children
are published with verified dependencies (2026-10-01). M4.1: historical 27-child draft
must not be published as-is. Neither module has been implemented by this planning work.
