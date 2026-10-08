-- Airbnb-style host profile: one row per host account (photo, about, languages, city).
-- Shown to guests on the host's listings. Photo lives in the private 'host-photo' object-store
-- bucket and is only ever served through a short-lived signed URL.
CREATE TABLE host_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  about text,
  city text,
  languages text[] NOT NULL DEFAULT '{}',
  photo_ref text,
  photo_mime_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
