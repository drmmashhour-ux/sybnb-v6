-- 077 — Shared driver base (2026-10-19). One driver account, one set of documents, car care log,
-- stars and key code, used by SR rides now and by food delivery later (same drivers, same review).
DO $$ BEGIN
  CREATE TYPE driver_document_kind AS ENUM ('LICENCE','REGISTRATION','INSURANCE','CRIMINAL_RECORD','MECHANIC_REPORT','EXPERIENCE','CAR_PHOTO_FRONT','CAR_PHOTO_BACK','CAR_PHOTO_LEFT','CAR_PHOTO_RIGHT','CAR_PHOTO_INSIDE','CAR_PHOTO_BOOT');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE driver_document_status AS ENUM ('IN_REVIEW','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE car_care_kind AS ENUM ('OUTSIDE','INSIDE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS driver_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         driver_document_kind NOT NULL,
  storage_key  TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  status       driver_document_status NOT NULL DEFAULT 'IN_REVIEW',
  admin_note   TEXT,
  expires_at   TIMESTAMP(3),
  reviewed_at  TIMESTAMP(3),
  created_at   TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP(3) NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind)
);

CREATE TABLE IF NOT EXISTS driver_car_care (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       car_care_kind NOT NULL,
  done_at    TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_car_care_user_idx ON driver_car_care (user_id, kind, done_at DESC);

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS key_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS on_duty_at TIMESTAMP(3);
