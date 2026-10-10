-- Self-selected account title/type chosen at sign-up (CLIENT, DRIVER, SELLER, BUYER, RENTER,
-- CAR_OWNER, HOST). A self-described intent on the profile, not a privileged role grant.
ALTER TABLE "users" ADD COLUMN "title" TEXT;
