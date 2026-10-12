# Google Play reviewer access (SYBNB, SYBNB Rides, SYBNB Stays)

Purpose: Play reviewers must be able to sign in and see the app working (Play Console -> App content -> App access).
Do NOT commit the password. Keep it in a password manager and paste it only into the Play Console form.

## 1. Create the reviewer account (owner does this once, ~3 minutes)

1. Pick a mailbox you can read (needed once for the sign-up code), e.g. an alias on info@sybnb.app.
   Use a dedicated address, never your personal or admin one.
2. Open https://sybnb.app, choose "Create account", register as a normal guest (role CLIENT / GUEST).
   Registration requires an email code (OTP); enter the code you receive.
3. Choose a NEW strong password used nowhere else. Save it in your password manager.
4. Sign out, sign in again with email + password to confirm it works. Regular guest sign-in needs no extra code
   (only ADMIN accounts need a fresh email code), so reviewers will not be blocked by an OTP.
5. Do not give this account ADMIN, SUPPORT or DRIVER roles.

## 2. What reviewers can do

- SYBNB Stays (app.sybnb.str): daily-stay search opens without signing in; sign in to view listing details and start a booking.
- SYBNB Rides (app.sybnb.sr): opens on the rides page; sign in to request a ride. Driver features are not
  reviewable with a guest account (drivers are approved by SYBNB), so say so in the notes.
- SYBNB (app.sybnb): full app, same account.

## 3. Text for Play Console -> App access ("All or some functionality is restricted")

Instructions: "Open the app. Tap the account icon, choose Sign in (email + password). Username: <REVIEW EMAIL>.
Password: <PASSWORD>. No verification code is needed for this account. Stays: search daily stays, open a listing and start a booking.
Rides: open the rides page and request a ride. Driver accounts are approved by SYBNB and are not part of the reviewer account."

## 4. Before submitting

- [ ] Account created, sign-in tested on the website and in the emulator
- [ ] Payments: do not ask reviewers to pay with a real card. Confirm what the booking flow shows for a review account
      (test mode or a stop before payment) and adjust the note above to match. Never share live Stripe keys.
- [ ] Rotate or delete the account after review if desired (owner/operator action).
