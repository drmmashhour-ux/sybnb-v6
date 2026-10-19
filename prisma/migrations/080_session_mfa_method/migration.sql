-- STEP 5: record HOW a session was authenticated (set only by the sign-in flow that verified the
-- emailed admin code). Additive and nullable; existing sessions read as NULL = password only.
ALTER TABLE "user_sessions" ADD COLUMN "mfa_method" TEXT;
