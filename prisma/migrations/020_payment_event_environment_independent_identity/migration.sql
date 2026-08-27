-- 020_payment_event_environment_independent_identity
-- Closes a real defect found by independent review of 2f928cd:
--
-- environment (policyEnvironment(), i.e. process.env.NODE_ENV) was part of the composite canonical
-- event identity: (provider, provider_endpoint_key, environment, provider_event_id). NODE_ENV is a
-- mutable, ambient runtime label, not a verified provider/endpoint property -- the exact same event
-- delivered to the exact same endpoint before and after a deployment's environment label changed (or
-- delivered concurrently to two processes with different NODE_ENV, e.g. a test script vs the live
-- server it drives) could create TWO independent PaymentEvent rows and be applied twice.
--
-- Confirmed as a REAL, already-manifested defect, not just a theoretical one: this exact live
-- database contains 2 pairs of duplicate rows for the same (provider, provider_endpoint_key,
-- provider_event_id) differing only by environment ('test' vs 'development') -- from
-- tests/e2e/payment-intents-booking.e2e.mjs's dead-letter-redelivery scenario, where the seeding test
-- process and the live server process evaluated policyEnvironment() to two different values for the
-- same event id. One pair applied twice as a direct, empirical result.
--
-- Fix, per the review's own offered alternative: providerEndpointKey already uniquely identifies the
-- endpoint/mode in this codebase (there is exactly one static endpoint key per rail today -- see its
-- schema comment). environment adds no genuine distinguishing identity information on top of that, so
-- it is removed from the canonical identity entirely. The column itself is kept as plain informational
-- metadata (which environment label received this event) -- never again used to fork identity.
--
-- Hand-written per this repo's established convention. Applied via `psql -f`, then `npx prisma generate`.

-- 1. Disambiguate existing rows that only differ by environment before the narrower constraint can
-- be created (it would otherwise fail on the same real duplicate data this migration exists to
-- close). NON-DESTRUCTIVE by design, consistent with this table's own established principle (see
-- migration 019 / PaymentEventConflict): a loser row is never deleted and never has its
-- processingStatus/attempts/lastError/timestamps touched. Its provider_event_id alone is suffixed
-- with a stable, reversible marker (the original value is always recoverable by stripping the
-- '#env_dedup_loser:<id>' suffix), which only disambiguates it from the surviving row under the new
-- constraint -- the full historical row, including whatever outcome it reached, remains queryable
-- exactly as it was. The survivor (kept under the ORIGINAL provider_event_id, so every existing
-- reference to it keeps working unchanged) is chosen by the more authoritative outcome (never
-- preferring a less-informative status over one that already represents a real financial effect --
-- the same principle migration 019 established for conflicting deliveries), tie-broken by earliest
-- received_at.
WITH ranked AS (
  SELECT
    id,
    provider,
    provider_endpoint_key,
    provider_event_id,
    row_number() OVER (
      PARTITION BY provider, provider_endpoint_key, provider_event_id
      ORDER BY
        CASE processing_status
          WHEN 'APPLIED' THEN 1
          WHEN 'FAILED' THEN 2
          WHEN 'DEAD_LETTERED' THEN 2
          WHEN 'QUARANTINED' THEN 3
          WHEN 'POLICY_DEFERRED' THEN 3
          WHEN 'IGNORED' THEN 4
          WHEN 'APPLYING' THEN 5
          WHEN 'RECEIVED' THEN 5
          ELSE 6
        END,
        received_at ASC
    ) AS rnk
  FROM payment_events
)
UPDATE payment_events e
SET provider_event_id = e.provider_event_id || '#env_dedup_loser:' || e.id
FROM ranked r
WHERE e.id = r.id AND r.rnk > 1;

-- 2. Replace the composite unique constraint: drop environment from it. Same constraint name kept
-- (payment_events_identity_key) -- referenced by isPaymentEventIdentityConflict()'s P2002 target
-- check in payment-event-pipeline.mjs, which needs no code change as a result.
ALTER TABLE payment_events DROP CONSTRAINT payment_events_identity_key;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_identity_key UNIQUE (provider, provider_endpoint_key, provider_event_id);
