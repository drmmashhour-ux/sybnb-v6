#!/usr/bin/env bash
# SYBNB — run the full governed E2E suite reproducibly against a local API + sybnb_v6.
# Dev/certification tool only (not part of the app runtime). Never used in production.
#
# Prereqs: local Postgres with the schema-correct `sybnb_v6` DB, and the synthetic user ids below.
# Usage:  bash scripts/run-all-e2e.sh
#         PAYMENT_ONLY=1 bash scripts/run-all-e2e.sh   -- runs ONLY the 14 payment suites; exits 0 iff
#         all 13 pass, independent of the other (pre-existing, unrelated) suites this script also runs
#         in full mode. Use this as the actual green/red gate for payment work -- the full-mode run
#         stays honestly non-zero while marketplace/cars/buy/rentals/new-construction/sell/advertising/
#         wallet have their own pre-existing, undiagnosed failures (confirmed via `git diff` against the
#         full payment-remediation commit range that none of their files were ever touched by that
#         work) that remain separately visible here, not silently dropped.
# Env (override as needed):
#   DB_URL, AUTH_SECRET, PHONE_HASH_SECRET, PAYMENT_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET,
#   STRIPE_SECRET_KEY, SELLER1, SELLER2, BUYER, ADMIN, HOST, GUEST
#
# Runs 3 server phases in sequence for the payment-policy suites (see server/lib/payment-policy.mjs):
# the main permissive server (most suites), a separate default-deny server (PAYMENT_INTENTS_ENABLED
# unset), and two simultaneous servers (stripe-unapproved + stripe-approved via NODE_ENV=test) for
# the stripe_checkout POLICY_DEFERRED recovery proof -- these three configurations are mutually
# exclusive and cannot be collapsed into one server.
set -uo pipefail
cd "$(dirname "$0")/.."

DB_URL="${DB_URL:-postgresql://$(whoami)@127.0.0.1:5432/sybnb_v6?schema=public}"
# Several of the newer payment e2e suites import Prisma directly (seeding/asserting DB state, not
# just calling the HTTP API), so DATABASE_URL must be visible to the `run()` function's own `node`
# invocations too, not just the server process it starts. Same reasoning applies to SYBNB_COUNTRY --
# payment-policy.e2e.mjs calls authorizePaymentOperation() (and therefore loadCountryProfile())
# in-process for a large share of its own assertions, not only via HTTP.
export DATABASE_URL="$DB_URL"
export SYBNB_COUNTRY="${SYBNB_COUNTRY:-syria}"
export AUTH_SECRET="${AUTH_SECRET:-dev-e2e-secret}"
export PHONE_HASH_SECRET="${PHONE_HASH_SECRET:-dev-e2e-phone}"
export PAYMENT_WEBHOOK_SECRET="${PAYMENT_WEBHOOK_SECRET:-whsec_sandbox_test}"
export STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-whsec_stripe_test}"
export STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-sk_test_fake_for_e2e_only}"
export RESEND_WEBHOOK_SECRET="${RESEND_WEBHOOK_SECRET:-whsec_dGVzdC13ZWJob29rLXNlY3JldA==}"
export SELLER1="${SELLER1:-1fdde54d-20f1-41ae-9f9a-2a4482f13c69}"
export SELLER2="${SELLER2:-f845e528-dff8-404f-b9ef-6f096fefd9c5}"
export BUYER="${BUYER:-b2cf0295-8b24-4be0-a014-8b9321c44e0a}"
export ADMIN="${ADMIN:-c6b57605-18aa-4093-bd99-264185de4b26}"
export HOST="${HOST:-480b860e-f32f-4089-a34b-5bbeec33952f}"
export GUEST="${GUEST:-e14887c6-6fff-4cab-bcea-62e1b976ea61}"
export SENDER="$SELLER1" RECIPIENT="$BUYER" OTHER="$SELLER2"
export DRIVER_ID="${DRIVER_ID:-$(psql -d sybnb_v6 -tAc "SELECT u.id FROM users u JOIN user_roles r ON r.user_id=u.id WHERE r.role='DRIVER' AND u.status='ACTIVE' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')}"
export GUEST2="${GUEST2:-ec554c79-c1e4-451a-b65c-206486a5a491}"

# Payment-policy env: every gate the milestone-2 authorizePaymentOperation() chain needs (see
# server/lib/payment-policy.mjs), plus the two rail-level flags that predate it. None of this existed
# when this script was first written -- added because the payment e2e suites were silently failing
# under this script's server (default-deny with nothing configured), never caught since every
# corrective round's own verification always started its server directly instead of through here.
# Exported (not just passed to the server subprocess) because several of the newer suites --
# payment-policy.e2e.mjs, payment-policy-stripe-approval-guard.e2e.mjs -- call
# authorizePaymentOperation()/resolveApprovedProviderConfig() directly, in-process, and read these
# same env vars for themselves; passing them only as an `env` prefix to the server command left the
# TEST process's own environment unset, silently producing wrong (but plausible-looking) denials.
export PAYMENTS_ENABLED=true
export PAYMENT_INTENTS_ENABLED=true
export PAYMENT_RAIL_MANUAL_PROOF_ENABLED=true
export PAYMENT_POLICY_TEST_COUNTRY_ELIGIBLE=true
export PAYMENT_POLICY_ELIGIBLE_DIVISIONS=STAYS,RENTALS,BUY,CARS,MARKETPLACE,NEW_CONSTRUCTION,PLATFORM,SR
export PAYMENT_OPERATION_PAYMENT_INTENT_CREATE_ENABLED=true
export PAYMENT_OPERATION_PAYMENT_INTENT_CAPTURE_ENABLED=true
export PAYMENT_OPERATION_PAYMENT_INTENT_REFUND_ENABLED=true
export PAYMENT_OPERATION_PAYMENT_INTENT_REPLAY_ENABLED=true
export PAYMENT_OPERATION_PAYMENT_INTENT_WEBHOOK_INTAKE_ENABLED=true
export PAYMENT_OPERATION_PAYMENT_INTENT_WEBHOOK_APPLY_ENABLED=true
export PAYMENT_OPERATION_PAYMENT_INTENT_RECONCILIATION_READ_ENABLED=true
export PAYMENT_OPERATION_STRIPE_CHECKOUT_CREATE_ENABLED=true
export PAYMENT_OPERATION_STRIPE_CHECKOUT_CAPTURE_ENABLED=true
export PAYMENT_OPERATION_STRIPE_CHECKOUT_WEBHOOK_INTAKE_ENABLED=true
export PAYMENT_OPERATION_STRIPE_CHECKOUT_WEBHOOK_APPLY_ENABLED=true
export PAYMENT_OPERATION_STRIPE_CHECKOUT_RECONCILIATION_READ_ENABLED=true
export PAYMENT_OPERATION_MANUAL_PROOF_CREATE_ENABLED=true
export PAYMENT_OPERATION_MANUAL_PROOF_CAPTURE_ENABLED=true
export PAYMENT_OPERATION_MANUAL_PROOF_REFUND_ENABLED=true
export PAYMENT_OPERATION_MANUAL_PROOF_PAYOUT_RELEASE_ENABLED=true
export PAYMENT_OPERATION_MANUAL_PROOF_RECONCILIATION_READ_ENABLED=true
export PAYMENT_OPERATION_MANUAL_PROOF_LEGACY_REFUND_ACCEPT_ENABLED=true
export PAYMENT_OPERATION_MANUAL_PROOF_REFUND_REQUEST_ENABLED=true

psql_reset() { psql -d sybnb_v6 -tAc "DELETE FROM seller_profiles WHERE user_id IN ('$SELLER1','$SELLER2'); DELETE FROM payment_proofs WHERE provider='seller_plan';" >/dev/null 2>&1; }

# Top the shared gift-sender fixture's SYP wallet back up before every run. wallet-gift.e2e.mjs
# spends real ledger balance on every execution (a 150,000-minor "large gift" in its admin-approval
# section alone) and never refunds it, so the fixture drains a little each run and the suite
# eventually fails with a confusing "Cannot read properties of undefined (reading 'id')" -- the gift
# create call had failed for insufficient funds. Observed for real: after three full-suite runs in
# one afternoon the balance had fallen to 123,000, below what section 6 needs. Nothing to do with
# any product code; the suite simply assumes a funded sender and had no step that guaranteed one.
fund_gift_fixture() {
  psql -d sybnb_v6 -tAc "UPDATE wallets SET cached_balance_minor = 50000000 WHERE user_id='$SELLER1' AND currency='SYP';" >/dev/null 2>&1
}

echo "== build + schema =="
npm run build 2>&1 | grep -oE "built in [0-9.]+s|error TS" || true
DATABASE_URL="postgresql://x@127.0.0.1:5432/x" npx prisma validate 2>&1 | grep -oE "is valid|error" || true

echo "== start API (OTP_EXPOSE_FOR_TEST + sandbox payment secret + full payment-policy config) =="
pkill -9 -f "server/index.mjs" 2>/dev/null; sleep 1
API_HOST=127.0.0.1 API_PORT=3051 OTP_EXPOSE_FOR_TEST=true SYBNB_COUNTRY=syria \
  node server/index.mjs > /tmp/sybnb-e2e-api.log 2>&1 &
API_PID=$!
sleep 3

fails=0
PAYMENT_ONLY="${PAYMENT_ONLY:-}"
run() { # name script [needs_reset]
  [ "${3:-}" = "reset" ] && psql_reset
  node "tests/e2e/$2" > /tmp/sybnb-e2e-out.log 2>&1
  local rc=$?   # governed suites process.exit(fail?1:0); sr-ride exits 0 on success
  printf "  %-18s %s  (exit %s)\n" "$1:" "$(tail -1 /tmp/sybnb-e2e-out.log)" "$rc"
  [ "$rc" -ne 0 ] && { fails=$((fails+1)); tail -5 /tmp/sybnb-e2e-out.log; }
}
# Same as run(), but skipped entirely in PAYMENT_ONLY mode -- for every suite NOT part of the payment
# regression, so $fails only ever reflects payment-suite outcomes when PAYMENT_ONLY=1.
run_full() { [ -n "$PAYMENT_ONLY" ] && return 0; run "$@"; }

if [ -z "$PAYMENT_ONLY" ]; then
  echo "== country isolation check (static) =="
  bash scripts/check-country-isolation.sh > /tmp/sybnb-iso.log 2>&1
  iso_rc=$?; printf "  %-18s %s  (exit %s)\n" "isolation:" "$(tail -1 /tmp/sybnb-iso.log)" "$iso_rc"
  [ "$iso_rc" -ne 0 ] && { fails=$((fails+1)); tail -8 /tmp/sybnb-iso.log; }
fi

echo "== self-contained integration certs =="
run_full "storage-s3" storage-s3-integration.e2e.mjs
run_full "sms"        sms-integration.e2e.mjs
run_full "country" country-selection.e2e.mjs
run_full "syria-wallet" syria-wallet.e2e.mjs
run_full "sr-geocoding" sr-geocoding.e2e.mjs
run_full "presentation" presentation.e2e.mjs
run_full "cars-title"   cars-title-display.e2e.mjs
run_full "calendar-guard" calendar-date-guard.e2e.mjs
run "payment-guard" payment-policy-stripe-approval-guard.e2e.mjs

echo "== api-backed governed suites =="
run_full "otp"              otp-identity.e2e.mjs
  run_full "email-otp"        email-otp.e2e.mjs
  run_full "email-security"   email-security.e2e.mjs
  run_full "signup-journey"   signup-journey.e2e.mjs
  run_full "seller-signup"    seller-signup-journey.e2e.mjs
  run_full "host-login"       host-login-journey.e2e.mjs
  run_full "staff-role-reg"   staff-access-role-registration.e2e.mjs
  run_full "admin-self-review" admin-self-review-protection.e2e.mjs
  run_full "session-revocation" session-revocation.e2e.mjs
  run_full "commit-boundary-reauth" commit-boundary-reauthorization.e2e.mjs
  run_full "resend-webhook"   resend-webhook.e2e.mjs
run_full "storage"          storage.e2e.mjs
run_full "legal"            legal-consent.e2e.mjs
run_full "operations"       operations.e2e.mjs
fund_gift_fixture
run_full "wallet"           wallet-gift.e2e.mjs
run "payment"          payment-sandbox.e2e.mjs
run "payment-race"     payment-proof-race.e2e.mjs
run "payment-intents"  payment-intents-booking.e2e.mjs
run "payment-policy"   payment-policy.e2e.mjs
run "payment-policy-enf" payment-policy-enforcement.e2e.mjs
run "payment-webhook"  payment-webhook-durability.e2e.mjs
run "payment-evt-dur"  payment-event-durability.e2e.mjs
run "payment-evt-id"   payment-event-identity.e2e.mjs
run "payment-evt-claim" payment-event-claim-recovery.e2e.mjs
run "payment-evt-supr" payment-event-supersession.e2e.mjs
run "payment-legacy-accept" legacy-refund-accept.e2e.mjs
run "payment-seller-plan-fee" seller-plan-fee-ledger.e2e.mjs
run "payment-refund-req" refund-request-creation.e2e.mjs
run "payment-refund-policy" refund-actor-policy-split.e2e.mjs
run "payment-refund-execute" refund-execution-wallet-credit.e2e.mjs
run_full "marketplace"      marketplace.e2e.mjs      reset
run_full "cars"             cars.e2e.mjs             reset
run_full "buy"              buy.e2e.mjs              reset
run_full "rentals"          rentals.e2e.mjs          reset
run_full "new-construction" new-construction.e2e.mjs reset
run_full "sell"             sell.e2e.mjs             reset
run_full "advertising"      advertising-payment-tunnel.e2e.mjs reset
run_full "search-filters"   listing-search-filters.e2e.mjs
run_full "sr-ride"          sr-ride.e2e.mjs
run_full "sr-ride-pooling"  sr-ride-pooling-discount.e2e.mjs

kill "$API_PID" 2>/dev/null
sleep 1

echo "== default-deny server (PAYMENT_INTENTS_ENABLED genuinely unset) =="
# -u unsets PAYMENT_INTENTS_ENABLED just for this one subprocess -- the test file itself
# (payment-webhook-default-deny.e2e.mjs) only ever asserts via HTTP against this server, never reads
# the flag in-process, so the script's own still-exported PAYMENT_INTENTS_ENABLED=true is harmless to
# the `run()` invocation that follows.
env -u PAYMENT_INTENTS_ENABLED \
  API_HOST=127.0.0.1 API_PORT=3051 OTP_EXPOSE_FOR_TEST=true SYBNB_COUNTRY=syria \
  node server/index.mjs > /tmp/sybnb-e2e-api-default-deny.log 2>&1 &
DEFAULT_DENY_PID=$!
sleep 3
run "payment-default-deny" payment-webhook-default-deny.e2e.mjs
kill "$DEFAULT_DENY_PID" 2>/dev/null
sleep 1

echo "== two simultaneous servers (stripe-unapproved :3051 + stripe-approved :3052, NODE_ENV=test) =="
API_HOST=127.0.0.1 API_PORT=3051 OTP_EXPOSE_FOR_TEST=true SYBNB_COUNTRY=syria \
  node server/index.mjs > /tmp/sybnb-e2e-api-stripe-unapproved.log 2>&1 &
STRIPE_UNAPPROVED_PID=$!
API_HOST=127.0.0.1 API_PORT=3052 OTP_EXPOSE_FOR_TEST=true SYBNB_COUNTRY=syria \
  NODE_ENV=test PAYMENT_POLICY_TEST_STRIPE_APPROVED=true PAYMENT_OPERATION_STRIPE_CHECKOUT_REPLAY_ENABLED=true \
  node server/index.mjs > /tmp/sybnb-e2e-api-stripe-approved.log 2>&1 &
STRIPE_APPROVED_PID=$!
sleep 3
API_BASE_UNAPPROVED=http://127.0.0.1:3051 API_BASE_APPROVED=http://127.0.0.1:3052 \
  run "payment-stripe-recovery" payment-event-stripe-policy-deferred-recovery.e2e.mjs
kill "$STRIPE_UNAPPROVED_PID" "$STRIPE_APPROVED_PID" 2>/dev/null

if [ -z "$PAYMENT_ONLY" ]; then
  echo "== production-mode server (gates.publicAccess enforcement only activates in production) =="
  # Two servers: the production-mode one exercises the closed gate (sections 1-3 of the suite); a
  # second, ordinary dev-mode one proves the gate is a no-op outside production (section 4) -- by
  # this point in the script every earlier phase's own server has already been killed, so this
  # can't reuse one of those the way the suite's own header assumes when run standalone.
  NODE_ENV=production API_HOST=127.0.0.1 API_PORT=3053 SYBNB_COUNTRY=syria \
    CORS_ORIGIN=https://example.com \
    EMAIL_PROVIDER=resend RESEND_API_KEY=test_key EMAIL_FROM=test@example.com \
    STORAGE_PROVIDER=s3 STORAGE_S3_BUCKET=test-bucket STORAGE_S3_REGION=us-east-1 \
    RESEND_WEBHOOK_SECRET="${RESEND_WEBHOOK_SECRET:-whsec_dGVzdC13ZWJob29rLXNlY3JldA==}" \
    ACCESS_GATE_TEST_OVERRIDE_CLOSED=true \
    node server/index.mjs > /tmp/sybnb-e2e-api-production-closed.log 2>&1 &
  PRODUCTION_CLOSED_PID=$!
  API_HOST=127.0.0.1 API_PORT=3054 SYBNB_COUNTRY=syria \
    node server/index.mjs > /tmp/sybnb-e2e-api-gate-open.log 2>&1 &
  GATE_OPEN_PID=$!
  sleep 3
  API_BASE_CLOSED=http://127.0.0.1:3053 API_BASE=http://127.0.0.1:3054 \
    run "public-access-gate" public-access-gate.e2e.mjs
  kill "$PRODUCTION_CLOSED_PID" "$GATE_OPEN_PID" 2>/dev/null
  sleep 1

  echo "== admin-action rate limit server (low ADMIN_ACTION_RATE_MAX to exercise the 429 path) =="
  ADMIN_ACTION_RATE_MAX=5 API_HOST=127.0.0.1 API_PORT=3055 SYBNB_COUNTRY=syria \
    node server/index.mjs > /tmp/sybnb-e2e-api-admin-ratelimit.log 2>&1 &
  ADMIN_RATELIMIT_PID=$!
  sleep 3
  API_BASE=http://127.0.0.1:3055 ADMIN_ACTION_RATE_MAX=5 \
    run "admin-rate-limit" admin-action-rate-limit.e2e.mjs
  kill "$ADMIN_RATELIMIT_PID" 2>/dev/null
fi

echo "== suites with failures: $fails =="
exit "$fails"
