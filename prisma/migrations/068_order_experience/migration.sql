-- SE (Eats) order experience (2026-10-15): pickup vs delivery, live tracking, restaurant
-- responses (busy mode, prep-time ETA, delay), scheduled orders, and the per-order chat.
--
-- Money semantics note (AGENTS.md §6): a PICKUP order charges NO delivery fee — explicit and
-- covered by tests/e2e/food-order-experience.e2e.mjs. Nothing else about pricing changes.

ALTER TABLE "merchants"
  ADD COLUMN "lat" double precision,
  ADD COLUMN "lng" double precision,
  -- Busy mode: the merchant's own pause switch. Fail-closed ordering: a paused store refuses new
  -- orders loudly so the customer can choose another restaurant or schedule for later.
  ADD COLUMN "accepting_orders" boolean NOT NULL DEFAULT true,
  ADD COLUMN "default_prep_minutes" integer;

ALTER TABLE "food_orders"
  -- 'delivery' (courier leg) or 'pickup' (customer collects; merchant hands over; no courier).
  ADD COLUMN "fulfillment" text NOT NULL DEFAULT 'delivery',
  -- The promise shown to the customer: set when the merchant accepts (prep minutes), moved by a
  -- delay. delayed_count > 0 reopens the customer's right to cancel until the food is ready.
  ADD COLUMN "eta_at" timestamptz,
  ADD COLUMN "delayed_count" integer NOT NULL DEFAULT 0,
  -- A future order ("schedule for next time"). Stored on the order; surfaced to the merchant.
  ADD COLUMN "scheduled_for" timestamptz;

-- Per-order chat between the three parties. Plain rows polled by the clients; sender_role is
-- recorded at send time so the transcript stays honest even if roles change later.
CREATE TABLE "food_order_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "food_orders"("id") ON DELETE CASCADE,
  "sender_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sender_role" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "food_order_messages_order_id_created_at_idx" ON "food_order_messages" ("order_id", "created_at");
