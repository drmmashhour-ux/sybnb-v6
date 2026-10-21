# Rezekme SR launch checklist (in order)

Rule: steps marked LOCKED need Mohamed's explicit approval in chat each time. Claude never merges, deploys, runs
production migrations or the Owner bootstrap on its own.

## A. Code (Claude, done)
- [x] Patches ready in ~/Downloads, applied in order, pushed to `rezekme-launch-fixes` (PR #7).
- [x] Unit tests (347) and real-HTTP e2e pass on a throwaway database; Stripe tested with a fake only.

## B. Review and staging (before anything live)
1. [ ] Mohamed applies the patches in order and pushes; read PR #7 once.
2. [ ] LOCKED: migrations 078–083 on a **staging copy** of the database first; check `/api/health/ready`.
3. [ ] Questions to answer: one organization in production? separate staging DB? legacy rows with NULL organization?

## C. Production setup (all LOCKED)
4. [ ] Merge PR #7.
5. [ ] Production migrations 078–083.
6. [ ] Render settings: `SYBNB_COUNTRY=syria`, `SR_REQUIRE_PREPAY=1`, payment-policy switches, `CORS_ORIGIN` (admin + rides + landing domains).
7. [ ] Owner bootstrap (first admin account), then admin MFA.
8. [ ] Domains: rezekme.com (landing), rides.rezekme.com, admin.rezekme.com on Vercel; DNS at GoDaddy.

## D. Keys and money (Mohamed enters; never Claude)
9. [ ] `ANTHROPIC_API_KEY` for real AI answers.
10. [ ] Stripe **test** key + webhook secret first; one real test top-up; live keys only after that.
11. [ ] Sham Cash QR and receiving account for wallet top-ups.
12. [ ] Maps: `ROUTING_OSRM_URL` or `GOOGLE_ROUTES_API_KEY`; optional `VITE_GOOGLE_MAPS_API_KEY`.

## E. Business settings (admin app, no deploy)
13. [ ] Pricing page: Load recommended formula, review the numbers, Save with a reason (minimum charge $10, $1 rounding).
14. [ ] Promo codes for launch week; business accounts if any.

## F. Legal and people
15. [ ] Terms, privacy, driver agreement; passenger insurance position; Syrian licensing for ride-hailing.
16. [ ] First approved drivers in Damascus (ID + vehicle checks) — without drivers nobody gets a ride.
17. [ ] Cross-border (Lebanon/Jordan): licensing, insurance, permits checked before enabling.

## G. Go-live
18. [ ] Test ride end to end: rider top-up -> request -> driver accept -> trip -> payout, with a test card then a real small one.
19. [ ] Soft launch (invite-only, one area), watch Live rides, Incidents, Money flow daily; adjust Pricing variables as needed.
20. [ ] Then SYBNB, then Joblop and radio Millo, each with the same checklist.
