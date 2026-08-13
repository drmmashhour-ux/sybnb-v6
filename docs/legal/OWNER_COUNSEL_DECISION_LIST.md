# SYBNB — Owner / Counsel Decision List

Every open `[[LEGAL/OWNER TO CONFIRM]]` item from the Terms and Privacy drafts, consolidated into
concrete questions to answer yourself or send to a lawyer. Answering these unblocks finalizing the
two documents. **Nothing here is legal advice.** Items are grouped; "Doc" cites where it appears
(T = Terms, P = Privacy).

## A. Business & entity
1. **Operating entity** — exact legal name, registration/number, registered address, and official
   contact for the operator of SYBNB. (T §Operator, T §14; P §Controller)
2. **Support/legal/privacy contacts** — confirm the public contact(s). Current in-product:
   `info@sybnb.app`, WhatsApp `00963998191422`. Is a separate legal/privacy address needed? (T §15, P §10)

## B. Regulatory / licensing (does SYBNB need a licence for any of these in Syria?)
3. **Intermediary status** — confirm SYBNB is characterized as an intermediary/facilitator (not a
   party to user transactions) and that this holds for **real estate**, **vehicle sales**,
   **transport (SR Ride)**, **advertising**, and **payments**. Any licensing/registration required
   for any division? (T §1, §8, §9)
4. **Driver vetting & transport** — required driver vetting standard, transport regulation,
   insurance, and driver employment status (independent contractor vs employee). (T §2, §8)
5. **Age/capacity** — confirm minimum age (draft says 18) and contractual-capacity wording. (T §2)

## C. Payments, fees & tax
6. **Payment-services licensing** — confirm SYBNB is **not** acting as a bank/money transmitter/
   payment institution, or identify what licence is required. (T §6)
7. **Commission** — confirm the Daily-Stay service commission rate (draft assumes **10%**) and which
   divisions it applies to. (T §6)
8. **Fees & refunds** — seller/advertising plan fee terms, billing, refundability, and the
   cancellation/refund terms for Daily-Stay bookings surfaced in-product. (T §5, §6)
9. **Card processing / PCI** — confirm the card provider (e.g. Stripe), that SYBNB stores no full
   card data, and PCI scope. (T §6; P §1, §3)
10. **Taxes/VAT & invoicing** — VAT/tax treatment and invoicing obligations, and currency handling
    (SYP vs settlement currency). (T §6)

## D. Wallet & promotional gifts
11. **Promotional-credit characterization** — confirm the Wallet/Gift is a **platform-funded
    promotional credit** (not the sender's money, not stored-value/e-money, no cash value), and that
    the expiry / non-transferability / single-use terms are acceptable and **not** a regulated
    payment/e-money product. (T §7; P §1)

## E. Content, conduct & enforcement
12. **Prohibited content & IP/takedown** — the prohibited-content list, intellectual-property policy,
    and notice-and-takedown / counter-notice process. (T §4, §10)
13. **Enforcement & appeals** — suspension/termination process, notice, appeal, and effect on
    pending transactions. (T §4, §12)
14. **Disclaimers & liability** — the enforceable "as is" disclaimer, limitation of liability, and
    indemnity, consistent with applicable law. *(The drafter deliberately did not assert specific
    limitations.)* (T §11)

## F. Privacy & data protection
15. **Lawful bases** — the lawful basis for each processing purpose, if applicable law requires one.
    (P §2)
16. **Processors** — the actual list of third-party processors (SMS provider, payment provider,
    cloud object storage, database/hosting, logging/monitoring), their locations, and confirmation
    that data-processing agreements are in place. Confirm SYBNB does not sell personal data. (P §3)
17. **International transfers** — whether data leaves Syria (cloud/SMS/payment providers) and the
    safeguards used. (P §4)
18. **Retention** — retention period for each category: accounts, **KYC documents**, payment
    records, messages, logs, and the **append-only wallet ledger / audit logs** (kept for integrity
    — decide retention). (P §5; T §3)
19. **KYC specifics** — when identity verification is mandatory, acceptable document types, and the
    lawful basis + retention for KYC documents. (T §3; P §1)
20. **Data-subject rights** — which rights are offered (access, correction, deletion, objection),
    the mechanism to exercise them, and legal limits (records SYBNB must retain). (P §7)
21. **Breach notification** — commitments/timelines per applicable law. (P §6)

## G. Contract mechanics
22. **Versioning & change notice** — how users are notified of material changes (the system already
    records consent against a specific version and can require re-consent). (T §13; P §9)
23. **Governing law, jurisdiction & disputes** — governing law, venue, dispute resolution/
    arbitration, and the controlling language of the contract. (T §14)
24. **Effective date & version numbers** — the effective date and initial version string to stamp on
    each document at publish (e.g. `1.0.0`). (T/P headers)

---

**Next step after answers:** counsel finalizes the two documents → the agent wires the approved
text + versions into `server/lib/legal.mjs` (flip `DRAFT`→`PUBLISHED`, bump versions), updates
`npm run test:e2e:legal`, and only then does "Final legal content approved" become YES. Until then
the platform correctly treats legal content as launch-blocking.
