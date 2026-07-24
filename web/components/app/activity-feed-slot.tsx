// The reserved slot for M3.8's activity feed (#104; SPEC m3.7 Further Notes).
// The locked mockup (docs/designs/app-dashboard.html) puts a "Recent activity"
// panel directly below the documents table; M3.8 builds it there. This ticket
// only holds the position so that build is a clean insertion, not a layout
// reflow — it renders no feature and no chrome. The empty region collapses
// (empty:hidden) so it takes no space until M3.8 fills it; the stable
// `data-slot` marks the seam for that work.
export function ActivityFeedSlot() {
  return <div data-slot="activity-feed" className="mt-10 empty:hidden" />;
}
