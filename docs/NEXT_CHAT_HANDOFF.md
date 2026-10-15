# Handoff for a fresh chat (2026-10-15)

## Where we are
- Repo ~/sybnb-v6, branch main, last pushed commit 94062d8; local commits 437a4eb (minSdk 24) and 23a453b (target API 36, versionCode 2) are NOT pushed yet -> user runs `git push origin main`.
- Android: 3 flavors (full app.sybnb, SR app.sybnb.sr, STR app.sybnb.str). Signed bundle for full app (version 2, API 36) built and uploaded to Play internal-testing draft. Build recipe (Terminal): JAVA_HOME=$HOME/Library/Java/JavaVirtualMachines/jbr-21.0.11/Contents/Home ./gradlew bundleFullRelease, then jarsigner with ~/Documents/SYBNB-keys/sybnb-release.jks alias sybnb (user types password). Upload by drag-and-drop (file picker greys .aab). Copy at ~/Desktop/sybnb-upload-app-full-release.aab (delete after).
- Play Console: org account verified (identity, website, phone). App "SYBNB" (app.sybnb) created. TODO: Select testers (email list), Preview and confirm release, Save and publish to internal track; then Android developer verification (register app.sybnb, .sr, .str); then declarations from docs/STORE_LISTINGS.md; reviewer account per docs/PLAY_REVIEW_ACCESS.md.
- Stays commission is 15% everywhere (owner confirmed 2026-10-11). SR rides rate unconfirmed (docs say 12%).
- iOS blocked on installing full Xcode (needs ~25 GB free).

## Codex work found uncommitted in the working tree (review before committing)
1. Money bug fix in server/lib/finance-ledger.mjs (retry of cancellation finalize clawed back host retained share) + host.mjs BOOKING_STAY_ENDED ordering + updated e2e/unit tests (docs/validation/CANCELLATION-RETRY-FIX.md). Reported passing on an isolated test DB; NOT re-run by Claude.
2. MSH testnet dashboard (#/wallet/msh): read-only Sepolia token balances, no signing. Files src/modules/msh/*, docs/msh/, scripts/msh/, tests/unit/msh-*.test.mjs, wallet/AppShell/App.tsx hooks.
3. MSH rewards preview: GET /api/me/msh-rewards-preview (server/lib/msh-rewards-preview.mjs, me.mjs). Read-only simulation. No token issuance, no migration.
Suggested: commit (1) separately after re-running tests; keep (2)/(3) off production until legal/treasury review.

## Next product goal
Make SR and STR simple for clients with weak internet (lean first screen, no video, light images, offline-friendly shell, SMS/short flows).

## Owner priorities for the next chat (2026-10-15)
1. SR + STR light: separate, fast apps/pages that clients open straight from the phone, for users with weak internet and little patience for complexity (lean first screen, no video, small images, offline-friendly shell, few steps). Android flavors app.sybnb.sr / app.sybnb.str already exist; PWA install page is #/get-app.
2. MSH token: intended to help clients and drivers do quick, easy jobs (rewards/payment convenience). Keep it testnet/read-only until legal + treasury review; do not issue real tokens or change money logic without explicit owner approval.
3. Then finish Google Play (testers, publish internal track, developer verification, declarations).
