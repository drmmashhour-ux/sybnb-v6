# Step 5G — Admin UX polish (+ mobile My Work pass)

Scope: shared components and the five reference screens. No security architecture, approval, finance, tax, restaurant-workflow or party-architecture change.

## Server changes (additive, read-only)
- `GET /api/admin2/work/items?q=` — search narrows the already authorization-scoped `where` (AND, never OR with scope). Fields: title (ILIKE, wildcards escaped), task-type label, platform display name. `q` must be 2–80 chars (else 400 `SEARCH_INVALID`); blank = no search. Not searched: description, reference, linked-entity names (not stored/indexed on work items).
- `GET /api/admin2/timeline` returns presentation fields `actorName` and `change` (status/priority from→to, assignee names). Stored append-only rows are untouched; no emails/ids exposed.
- Fail-closed hardening: `visibleScope` now throws 401 `AUTH_REQUIRED` for anonymous callers (was a 500). LIKE metacharacters in search input are escaped.

## UI
- Context switcher only offers values that change request scope (`context.ts`); single legal entity shown plainly; unavailable choices disabled and labelled.
- `events.ts` reusable formatter with neutral fallback (no raw JSON, UUIDs, column names).
- `states.ts` six distinct error/empty states; `roles.ts` ACTIVE/PENDING/HISTORICAL.
- Command Center re-ordered around exceptions; SR Restaurants tiered; Order Detail marks Connected / Fixture / Not yet connected; Party Detail rebuilt.
- Buttons: primary / secondary / tertiary / danger; `ConfirmDialog` exists and is tested but no live screen uses it (no dangerous workflow implemented).
- Mobile My Work: scrollable tab strip with fade cue, single Filters [n] sheet (focus trap, Esc, focus return), compact top bar, breadcrumb hidden on phones, badge order Priority → Status → Risk → Overdue with only HIGH risk/overdue as badges, 2-line titles, distinct platform line.

## Known limitations
- Per-item "why" text does not exist in the backend; guidance is derived from type/priority/dates/assignment and labelled as such.
- Command Center "Recent activity" still shows humanised audit action names.
- Order Detail audit section queries entity type `restaurant_order` (normally empty).

## Tests
tsc clean; unit 279/279; admin e2e suites incl. `admin-ui-5g.e2e.mjs` (search authz/validation/wildcards/anonymous, timeline fields); axe A/AA 0 violations; keyboard 25/25; mobile (320/375/390/430) 66/66; production bundle has 0 fixture strings.
