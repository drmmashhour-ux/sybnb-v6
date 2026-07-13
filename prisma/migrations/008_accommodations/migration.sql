-- Accommodation groups multiple STAYS room-type Listings under one physical property, so a host
-- with a hotel-like setup (Studio, Suite, Double-Queen, etc.) can share one set of location/
-- documents/photos across room types instead of repeating the whole listing wizard per room.
CREATE TABLE accommodations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  title_ar text NOT NULL,
  title_en text,
  description text,
  governorate text NOT NULL,
  city text NOT NULL,
  area text,
  address text,
  status text NOT NULL DEFAULT 'DRAFT',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accommodations_owner_id_idx ON accommodations (owner_id);

CREATE TABLE accommodation_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accommodation_id uuid NOT NULL REFERENCES accommodations(id) ON DELETE CASCADE,
  url text NOT NULL,
  kind text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accommodation_media_accommodation_id_idx ON accommodation_media (accommodation_id);

ALTER TABLE listings ADD COLUMN accommodation_id uuid REFERENCES accommodations(id);
CREATE INDEX listings_accommodation_id_idx ON listings (accommodation_id);
