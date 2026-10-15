# MSH testnet dashboard — active SYBNB V6

Repository: drmmashhour-ux/sybnb-v6. Mac checkout: ~/sybnb-v6.
Baseline: 94062d84ec44154c4abc6fd28d565471808686dc.

The #/wallet/msh route is a read-only dashboard behind V6's existing guest sign-in gate. The financial wallet page links to it. MetaMask must be on Ethereum Sepolia; balances are read for the pinned test contract 0x4343d04D4331F54e875007FB725E80f029Cf83d8. No signature or transaction request is implemented. The dashboard checks bytecode presence, token metadata, fixed supply, account consistency, and a fixed read block. It supports Arabic, English, and French.

Runtime delta: three new MSH module files plus small additions to App.tsx, WalletPage.tsx, and AppShell.tsx. No file movements, country configuration edits, country selection changes, backend APIs, migrations, booking/credit-wallet integration, or payment/legal semantic changes. Production deployment remains blocked and was not performed.

Checks: npm run build passed; eight focused MSH tests passed. Browser checks verified guest sign-in gating, consent, both account balances, read-only refresh, account/network changes, mainnet rejection, rejected connection, Arabic RTL, French, mobile layout, wallet navigation, and no uncaught errors. Browser fixtures use simulated wallet responses and a test-only client session; they do not validate a real identity/backend session.

The complete unit suite ran 55 tests: 52 passed and 3 booking-policy tests failed. The same three failures reproduce on unmodified baseline 94062d8 (regular-price late cancellation refund, protected-price post-check-in refund, and commission/host-share calculation). Those financial rules were not changed. The governed database/payment E2E suite was not run. This dashboard work is not a country-separation phase or full production certification.

Run focused checks with Node 24:

```sh
node --test tests/unit/msh-read-only.test.mjs
npm run build
npm run preview -- --port 5186 --strictPort
```

Open http://127.0.0.1:5186/#/wallet/msh after signing in through the existing V6 session/API setup. Preview serves only the frontend; it does not start a backend. No auth, public-access, country, or payment gate should be relaxed to make the test page reachable.

The corrected installer checks Git origin matches drmmashhour-ux/sybnb-v6 before making changes, checks integration anchors and conflicting new files, and backs up the three modified source files. It refuses the earlier figma-design project. Rollback restores those three files from the backup and removes only new files listed in its manifest, after preserving any later edits. No main history rewrite is necessary.
