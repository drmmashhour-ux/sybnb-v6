# SYBNB Reusable Capsules

This folder records the shared capsule system used across STR, rentals, seller, advertising, marketplace, SR, and future country versions.

## Capsule Standards

- Account Gate Capsule: sign up / sign in, phone number, verification code, return path.
- Search Capsule: main group, governorate, city, area, optional date, search button.
- Filter Capsule: visual touch choices copied from STR and adapted per division.
- Payment Capsule: amount, payment method, proof upload, admin review, confirmation.
- Map Capsule: Google Maps online link plus offline coordinate fallback.
- Admin Decision Capsule: accept, reject, hold, reopen, send to client, send to host/seller.
- Location Capsule: STR and renter search share `src/engines/search` for full Syria governorate, city, area, and street data.
- Case Status Capsule: dispute/complaint status shown only from a real fetched status field; steps and copy are derived from the status enum, never hardcoded as complete.

## Hard Rule

Search can be public, but any state-changing action must pass account first:

- STR guest: account before reservation request.
- Renter: account before sending monthly rental request.
- Buyer: account before sending a property visit/contact request.
- Seller by himself: account, plan, payment, proof, admin confirmation, then listing wizard.
- Seller through SYBNB network: account, documents, admin confirmation, commission model, then platform-managed sale.
- Advertising client: account, plan/payment, proof upload, admin confirmation, then publishing.
- Cars, marketplace, and new construction: public search first, then detail page, then account before contact/request.

## Current Implementation

Code capsule contracts live in:

`src/shared/capsules/index.ts`

The renter and buyer pages now follow STR logic:

1. Search capsule first.
2. Results and detail tunnel appear after Search.
3. Location choices use the same STR Syria engine, not a small duplicate list.
4. Final request requires account, documents, and agreement.
5. `/rentals` uses RENTALS inventory and renter wording.
6. `/buy` uses BUY inventory and buyer wording.

## Direct Search Routes

These public routes now open the search engine directly:

- `/stays`: STR daily-rent search.
- `/rentals`: renter capsule search.
- `/buy`: buyer capsule search.
- `/cars`: vehicle search.
- `/marketplace`: marketplace search.
- `/new-construction`: project search.

The old division intro page remains available only as a fallback pattern, not as the primary client tunnel.
