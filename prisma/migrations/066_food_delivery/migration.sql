-- 066 — SE (Eats) food & grocery delivery, Phase 1 (2026-10-15).
-- Merchants, menus, orders with full lifecycle. One platform: couriers are DRIVER users, customers
-- are GUEST users, admins approve merchants. Cash-on-delivery only in Phase 1 (wallet/ledger
-- integration is its own later phase per AGENTS.md §6). Prices snapshot into order items so later
-- menu edits never change what an existing order says it cost.
-- Column types follow 001_platform_foundation: uuid keys, timestamptz timestamps.

CREATE TYPE "MerchantStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'SUSPENDED');
CREATE TYPE "FoodOrderStatus" AS ENUM ('PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED', 'CANCELLED', 'REJECTED');

CREATE TABLE merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_ar text,
  category text NOT NULL DEFAULT 'restaurant',
  city text NOT NULL,
  address text NOT NULL,
  phone text,
  status "MerchantStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX merchants_owner_id_idx ON merchants(owner_id);
CREATE INDEX merchants_status_active_city_idx ON merchants(status, active, city);

CREATE TABLE menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_ar text,
  description text,
  price_minor integer NOT NULL,
  currency text NOT NULL,
  available boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX menu_items_merchant_id_available_idx ON menu_items(merchant_id, available);

CREATE TABLE food_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  courier_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status "FoodOrderStatus" NOT NULL DEFAULT 'PLACED',
  subtotal_minor integer NOT NULL,
  delivery_fee_minor integer NOT NULL DEFAULT 0,
  service_fee_minor integer NOT NULL DEFAULT 0,
  total_minor integer NOT NULL,
  currency text NOT NULL,
  payment_method text NOT NULL DEFAULT 'cash',
  delivery_address text NOT NULL,
  delivery_lat double precision,
  delivery_lng double precision,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}',
  accepted_at timestamptz,
  ready_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX food_orders_merchant_id_status_idx ON food_orders(merchant_id, status);
CREATE INDEX food_orders_customer_id_idx ON food_orders(customer_id);
CREATE INDEX food_orders_courier_id_idx ON food_orders(courier_id);
CREATE INDEX food_orders_status_idx ON food_orders(status);

CREATE TABLE food_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  name_snapshot text NOT NULL,
  price_minor_snapshot integer NOT NULL,
  quantity integer NOT NULL
);
CREATE INDEX food_order_items_order_id_idx ON food_order_items(order_id);
