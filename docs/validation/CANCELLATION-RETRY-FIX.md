# Cancellation retry correction

A sequential repeat of admin cancellation finalization could undo the host's retained payout. The first call posted a `booking_payout` RELEASE for the retained host share. A second call queried any prior RELEASE and mistook this retained release for a full pre-cancellation payout, creating an inappropriate `booking_payout_clawback` DEBIT. The retry appeared successful and existing count assertions missed the new debit; wallet conservation and later host withdrawal/refund tests exposed it.

The rule-based finalizer now excludes its own retained-release idempotency key from the earlier-full-payout lookup. The retained release remains idempotent. A genuine earlier full payout still follows the original clawback path. No commission, refund percentage, fee, actor permission or negative-balance policy is changed. No automatic historical correction is included: any real records previously affected by the bug require explicit ledger reconciliation, not deleting/editing past ledger entries.

The host cancellation endpoint also reports BOOKING_STAY_ENDED consistently for an expired stay already marked COMPLETED by a sweep. It continues to deny cancellation; it does not permit refunding an ended stay.

## Tests

The isolated real API booking-money-flow suite passes 101 checks, including repeated/concurrent retained-release retries, unchanged balances/clawbacks, a historical full-payout control and its retry, conservation, refund execution and host withdrawals. Refund actor-policy split passes 30; admin self-review protection passes 24; commit-boundary rounds 2, 3 and 4 pass 227, 93 and 35 respectively. All 62 unit tests pass. Full governed validation remains a separate release gate; see the latest handoff report.

Fixture-only corrections preserve real guards: synthetic drivers now have approved identity, registered/approved/inspected vehicles, current registration and matching ride categories; cancellation-fee probes start outside the grace period and use the existing 15% launch rule; host fee fixtures have funded wallets; refund fixtures use future unused stays. Round 3 probes the current atomic claim/apply transaction's internal staged claim and its invisible separate-connection view, rather than claiming the pre-round-5 separate claim had committed. Round 4 distinguishes unpaid billed/awaiting fare from collected earnings. Production eligibility, no-overdraw, authorization, claim/commit and financial policies are not relaxed to make tests pass.

Use only the isolated helper/test database. Do not run the unmodified governed runner against a real database or use its broad pkill. This change does not enable live payments, monetary rewards or deployment.
