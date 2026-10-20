# STEP 5F — Admin visual / UX foundation

Scope: one design system and five validated screens. Security architecture is frozen; nothing in 5F changes
authorization. The server (`/api/admin2`) still decides every request; the UI only chooses what to draw.

## Where it lives
`src/admin/` — self-contained, scoped under `.adm` (never leaks into the consumer app). Mounted by `src/app/App.tsx`
only for the console paths in `src/admin/nav.ts#isConsolePath`; every other `/admin/...` page keeps its existing page.
The console renders left-to-right English regardless of the consumer site's language/direction.

## Routes
| Route | Screen |
|---|---|
| `/admin` | Command Center |
| `/admin/work` | My Work (+ side panel; `?open=<id>` from search) |
| `/admin/sr/restaurants` | SR Restaurants overview |
| `/admin/sr/restaurants/orders/:id` | Live restaurant order detail |
| `/admin/parties/:id` | Party detail |
| `/admin/parties` | Parties list (entry point to Party detail; same DataTable) |

## Components (`src/admin/components`)
`ui.tsx`: PageHeader, EntityHeader, MetricCard, PlatformCard, TaskCard, StatusBadge, RiskBadge, Tabs/TabPanel, FilterBar,
SearchInput, Timeline, EntityTimeline, SidePanel, CommentPanel, ActionMenu, EmptyState, ErrorState, LoadingSkeleton.
`DataTable.tsx`: DataTable + Pager. `shell.tsx`: AppShell, Sidebar, TopBar, ContextSwitcher, search panel, NotificationIndicator, user menu.

## Real-data rules
* Every number comes from `/api/admin2`. Missing data renders "Not available" / setup / "coming soon", never a zero or a sample.
* Sidebar entries show only if `/me` says the user holds the permission / platform authorization. Screens not built yet show a "Soon" tag and are not links.
* Fixtures (`fixtures.ts`, `fixtures-data.ts`) load only when the Vite **dev** build is started with `VITE_ADMIN_FIXTURES=1`
  (`import.meta.env.DEV` is false in production, so the chunk is not even emitted — asserted on the built bundle).
  Fixture screens carry a "DEVELOPMENT FIXTURE DATA" banner.
* Order actions (Contact Restaurant/Courier, Open Support Case, Request Cancellation, Reassign Delivery) are disabled and say "Coming soon".

## Small API additions (read-only, scope-preserving)
* `GET /work/items?view=priority` — open HIGH/URGENT items (My Work "High Priority" tab).
* `assignedUserName` on work items — display name only (no email/phone).

## Review tooling (not part of the regression suite)
`tests/e2e/helpers/admin-ui-record.mjs` seeds clearly synthetic demo data into a **scratch test database** through the real API and records the
responses the screens read. Screenshots are rendered from those recorded real responses.

## Tests
`tests/unit/admin-ui-{logic,render,guards}.test.mjs`, `tests/e2e/admin-ui-5f.e2e.mjs`.
