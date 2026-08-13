# SYBNB — Privacy Policy (DRAFT)

> **DRAFT — NOT LEGAL ADVICE — NOT YET IN EFFECT.**
> Prepared by the engineering agent as a *starting draft describing the data the platform actually
> processes* (based on the implemented system), for review by the owner and qualified legal/privacy
> counsel. It is **not** authoritative. Do **not** publish until reviewed and approved. Every
> `[[LEGAL/OWNER TO CONFIRM: …]]` marker requires a human decision the drafter must not make. The
> versioned-consent system keeps `privacy` at status `DRAFT` (launch-blocking) until an approved
> version is published. This draft describes processing **as implemented**; it must not claim
> compliance with any specific law or certification that has not been verified.

**Effective date:** `[[LEGAL/OWNER TO CONFIRM]]` · **Version:** `[[set on publish]]`
**Controller:** **9375-7649 QUÉBEC INC.** (Québec, Canada) `[[OWNER/COUNSEL TO CONFIRM address +
whether a privacy officer/DPO is required]]`
> **Counsel note (material):** as a Québec enterprise, **Québec Law 25** (and potentially Canadian
> PIPEDA) likely applies in addition to any Syrian requirements. Applicable privacy regime, the
> privacy-officer requirement, breach thresholds, and data-subject rights/periods are for counsel.

## 1. Data we process (as implemented)
- **Account:** display name, email, **phone number** (stored as a salted hash, `phoneHash`), and
  password (stored hashed with scrypt — never in plaintext).
- **Verification (OTP):** verification codes are stored **only as HMAC hashes** with an expiry,
  attempt count, and status; the plaintext code is never stored and is never returned to
  production clients.
- **Identity documents (KYC):** if you upload an ID document, the file is stored in **private
  storage** under a random key and is retrievable only by authorized operators (via short-lived
  signed access); the browser only ever sends the file, never a public link.
- **Listings & content:** listing details, media references, and metadata you submit.
- **Messages/inquiries:** conversations between buyers/renters and sellers/hosts.
- **Payments:** manual payment **references/proof** you provide and, where a card provider is used,
  provider references and payment status/events (SYBNB does **not** store full card numbers; card
  data is handled by the payment provider). `[[LEGAL/OWNER TO CONFIRM: PCI scope + provider]]`
- **Wallet/gifts:** promotional credit balances, gift records (recipient phone hash, amount, status,
  expiry) and an append-only wallet ledger.
- **SR Ride:** pickup/dropoff locations and ride status for rides you request or fulfill.
- **Technical:** request logs with a correlation id, timestamps, and status. **Sensitive values
  (passwords, tokens, OTP codes, authorization headers, payment/card fields) are redacted from logs
  and never logged in plaintext.**

## 2. Why we process it
To create and secure accounts, verify phone numbers, moderate and display listings, enable
communication, process/verify payments, operate the wallet/gift promotion, dispatch rides, prevent
fraud/abuse, and meet legal obligations. `[[LEGAL/OWNER TO CONFIRM lawful bases where applicable]]`

## 3. Sharing & processors
SYBNB uses third-party processors to operate the service, which may include: an **SMS provider**
(OTP delivery), a **payment provider** (card processing), **cloud object storage** (documents/
media), a **database/hosting provider**, and logging/monitoring. `[[OWNER TO LIST the actual
processors, their locations, and ensure appropriate data-processing agreements]]`. SYBNB does not
sell personal data. `[[LEGAL/OWNER TO CONFIRM]]`

## 4. International transfers
`[[LEGAL/OWNER TO CONFIRM: whether data leaves Syria (e.g. cloud/SMS/payment providers) and the
safeguards used]]`

## 5. Retention
`[[LEGAL/OWNER TO CONFIRM retention periods per data category — e.g. accounts, KYC documents,
payment records, messages, logs, wallet ledger. The system supports deletion of stored objects; the
wallet ledger and audit logs are append-only for integrity and require a retention decision]]`

## 6. Security (as implemented)
HMAC-signed session tokens with per-request server-side role/status checks; passwords hashed
(scrypt); OTP codes hashed; private storage with signed, time-limited retrieval for sensitive
documents; strict object keys (no path traversal); brute-force/rate limiting on verification and
credential endpoints; security response headers; request-body size limits; and access controls that
scope wallet, listing, inquiry, KYC, and payment data to their owner or an authorized operator. No
system is perfectly secure. `[[LEGAL: breach-notification commitments per applicable law]]`

## 7. Your rights
`[[LEGAL/OWNER TO CONFIRM the rights offered — e.g. access, correction, deletion, objection — the
mechanism to exercise them, and any legal limits (e.g. records SYBNB must retain).]]`

## 8. Children
The service is not directed to anyone under 18. `[[LEGAL to confirm]]`

## 9. Changes
This policy is versioned; material changes may require renewed consent recorded against the version
you accept. `[[LEGAL: notice mechanism]]`

## 10. Contact
Privacy: `privacy@sybnb.app` · Legal: `legal@sybnb.app` · Support: `support@sybnb.app`
(owner-recommended) `[[OWNER TO CREATE/CONFIRM]]`. Also `info@sybnb.app`, WhatsApp `+963 998 191 422`.
