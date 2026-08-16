# SYBNB — Syrian Authority Notification / Submission Package
### حزمة إشعار / تسجيل تطبيق SYBNB لدى الجهة السورية المختصة
**Status:** DRAFT prepared by the SYBNB team for owner review — **not yet submitted.** Prepared for a **Syria-only** launch with **payments disabled**. Public access remains CLOSED until the notification/acknowledgment step and the production smoke test are complete.

**Confidence legend / مفتاح الدرجة:** **[REQUIRED]** = appears required by the authority · **[RECOMMENDED]** = good practice / likely helpful · **[NOT CONFIRMED]** = must be verified directly with the authority before relying on it.

---

## 0. Regulatory basis (as researched — verify with the authority)
- **Regime:** Per the Syrian **Ministry of Communications and Technology** decision of **16 April 2025**, prior **licensing/permits/fees** for services delivered through electronic applications were **abolished** and replaced with a **notification model**: after **commercial registration**, the operator **notifies** the **National Authority for Information Technology Services (NAITS / الهيئة الوطنية لخدمات تقنية المعلومات)** — no prior approval required. Hosting **outside Syria is permitted** except national-security exceptions; access to app data/control panels is **prohibited except by court order**. Reported Authority director: Shahada al-Ibrahim.
- **[NOT CONFIRMED] — the single most important item:** the notification process as reported assumes a **Syrian commercial registration**. SYBNB's operator is a **Québec (Canada) company**. Whether a Syria-only app run by a **foreign operator** can notify **directly**, or requires a **Syrian commercial registration / local agent / branch**, is **not confirmed**. This must be clarified with NAITS **before** submission — it may become an OWNER ACTION (establish a Syrian registration or authorized local agent).
- Sources: SANA (owner-provided); Enab Baladi (Apr 2025); Al-Arabia-Law tech-sector guide. Treat procedural specifics as indicative until confirmed by the Authority.

---

## 1. Cover / notification letter — خطاب الإشعار

**العربية**
> إلى: الهيئة الوطنية لخدمات تقنية المعلومات — وزارة الاتصالات وتقنية المعلومات، الجمهورية العربية السورية
> الموضوع: إشعار بإطلاق تطبيق إلكتروني (SYBNB) وفق نظام الإشعار المعتمد بقرار 16 نيسان/أبريل 2025.
> تتقدّم شركة **9375-7649 QUÉBEC INC.** بإشعار الهيئة برغبتها بتشغيل منصّة **SYBNB** الموجّهة حصراً للسوق السوري، منصّة رقمية متعددة الأقسام (إيجار يومي، إيجار شهري، بيع عقارات، مشاريع جديدة، سيارات، سوق، نقل SR، وإعلانات). تُطلَق المنصّة في مرحلتها الأولى **بدون تفعيل الدفع الإلكتروني**. نرفق طيّه وصف المنصّة والبيانات التقنية والأمنية والمعلومات القانونية، ونطلب توضيح أي نموذج أو إجراء إضافي تتطلبه الهيئة.

**English**
> To: National Authority for Information Technology Services — Ministry of Communications and Technology, Syrian Arab Republic.
> Subject: Notification of an electronic application (SYBNB) under the notification regime adopted by the decision of 16 April 2025.
> **9375-7649 QUÉBEC INC.** hereby notifies the Authority of its intent to operate **SYBNB**, a Syria-only multi-division digital platform (Daily Stays, Monthly Rentals, Buy Property, New Construction, Cars, Marketplace, SR Ride, Advertising). Phase 1 launches **with electronic payments disabled**. The platform description, technical/security details, and legal information are attached. We request confirmation of any additional form or step the Authority requires.

## 2. Operator / company information — بيانات المُشغّل  **[REQUIRED]**
- **Legal operator:** 9375-7649 QUÉBEC INC. (a Québec, Canada incorporated company). *Québec/Canada is the place of incorporation, NOT a service market.*
- **Service market:** Syria only. Not offered to a Canadian/Québec consumer market.
- **Owner/principal contact:** [owner name] — [phone] — info@sybnb.app.
- **Attachment [REQUIRED]:** Canadian corporate-registration certificate for 9375-7649 QUÉBEC INC. *(owner supplies the actual PDF; certified Arabic translation likely [RECOMMENDED]).*
- **[NOT CONFIRMED]:** whether a Syrian commercial registration / local authorized agent is required for a foreign operator (see §0).

## 3. Platform purpose & divisions — غرض المنصّة والأقسام  **[REQUIRED]**
SYBNB is an **intermediary** platform connecting users with providers across:
| Division | AR | Model |
|---|---|---|
| Daily Stays (STR) | الإيجار اليومي | booking request → host contact |
| Monthly Rentals | الإيجار الشهري | contact/inquiry (IMMOContact) |
| Buy Property | شراء عقار | offer/visit/contact |
| New Construction | مشاريع جديدة | visit request / contact |
| Cars | المركبات | contact-only (inspection arranged in-platform) |
| Marketplace | السوق | product listing + contact |
| SR Ride | سير | ride request; **drivers vetted, no public self-registration** |
| Advertising | إعلانات | paid banner placement |
Purpose: reduce friction and increase trust for renting, buying, vehicles, goods, rides, and services inside Syria.

## 4. Hosting / data architecture — الاستضافة وبنية البيانات  **[REQUIRED]**
- **Hosting: outside Syria** (permitted by the 16 Apr 2025 decision except national-security). Intended providers: application compute + **PostgreSQL** database (managed, e.g. Render/Neon), **S3-compatible object storage** (Cloudflare R2) for media/ID documents, **Resend** for transactional email. Regions: to be finalized with the owner's provider selection.
- **Data-access posture:** aligns with the decision — no third party accesses app data/control panels; production credentials are least-privilege; **[RECOMMENDED]** statement that data is disclosed only under valid legal/court process.
- **[NOT CONFIRMED]:** whether the Authority requires any category of data (e.g., specific logs) to be retained in-country; verify.

## 5. Privacy & security description — الخصوصية والأمن  **[REQUIRED]**
- **Authentication:** email one-time-password (OTP); phone optional; server-authoritative, rate-limited, attempt-locked; no OTP values exposed.
- **Identity/KYC:** national ID or passport image required before a first booking is confirmed; stored **private** (signed retrieval only), size/type validated.
- **Transport & storage:** HTTPS/TLS; phone numbers stored **hashed**; secrets never in client bundle or logs (log redaction verified); production **fails closed** on missing/unsafe configuration.
- **Access control:** role-based; per-owner tenant isolation (a host cannot access another's data).
- **Abuse protection:** per-IP and per-identifier rate limiting; upload validation.
- **[RECOMMENDED]:** attach the Terms of Service and Privacy Policy drafts (`docs/legal/`), noting they are DRAFT pending finalization.

## 6. User verification & content moderation — التحقق من المستخدمين ومراقبة المحتوى  **[REQUIRED]**
- **User verification:** email-OTP for all accounts; ID/KYC before first booking; **drivers vetted** (no public self-registration).
- **Content moderation:** every listing enters **PENDING_REVIEW** and is **admin-reviewed → APPROVED / REJECTED** before it is publicly visible; test/synthetic inventory excluded from production.
- **[RECOMMENDED]:** a stated takedown/reporting path and prohibited-content policy consistent with Syrian law.

## 7. Payments-off launch model — نموذج الإطلاق بدون دفع  **[REQUIRED to state]**
- Phase 1 launches with **electronic payments DISABLED** — no card processing, no charges, no held customer funds.
- **Wallet/Gift = promotional platform credit only** (not cash, not customer money held).
- **All platform fees waived through 31 December 2026** and not auto-activated.
- Any future payment activation would be a **separate step** and, if required, separately notified.

## 8. Contact details — بيانات التواصل  **[REQUIRED]**
- support@sybnb.app (user support) · legal@sybnb.app (legal) · privacy@sybnb.app (privacy requests) — *[owner to create these mailboxes]*
- WhatsApp: +963 998 191 422 · info@sybnb.app

## 9. Technical / security documentation (attachments) — الوثائق التقنية  **[RECOMMENDED]**
- Architecture summary (API + SPA + Postgres + object storage + email).
- Health/readiness endpoints; structured logging; rate limiting; backups/PITR plan; rollback procedure.
- Security posture: fail-closed config, secret handling, upload validation, tenant isolation.
- (These exist in the SYBNB `docs/launch/` runbooks and can be summarized for the Authority.)

## 10. Terms & Privacy drafts — مسودتا الشروط والخصوصية  **[RECOMMENDED]**
- Attach `docs/legal/TERMS_OF_SERVICE.draft.md` and `docs/legal/PRIVACY_POLICY.draft.md`, clearly marked **DRAFT — not yet in effect**.

## 11. Forms / letters required by the authority — النماذج المطلوبة  **[NOT CONFIRMED]**
- The specific NAITS notification **form(s)**, submission channel (portal / email / in-person), language requirement, and any acknowledgment/receipt format are **not confirmed** in public sources. **Do not assume** — confirm directly with NAITS and complete whatever official form they specify.

---

## What is REQUIRED vs RECOMMENDED vs NOT CONFIRMED (summary)
- **REQUIRED (assemble now):** operator info + Canadian registration cert (§2); platform description (§3); hosting/data (§4); privacy/security (§5); verification/moderation (§6); payments-off statement (§7); contacts (§8).
- **RECOMMENDED:** technical/security attachments (§9); Terms/Privacy drafts (§10); Arabic translations of key attachments.
- **NOT CONFIRMED (verify with NAITS before submitting):** (a) whether a foreign operator needs a **Syrian commercial registration / local agent** (§0/§2) — potentially the biggest owner action; (b) the exact **notification form and channel** (§11); (c) any **in-country data-retention** requirement (§4).

## Immediate next steps
1. **[OWNER ACTION]** Confirm with NAITS: the exact notification form/channel **and** whether a foreign (Québec) operator may notify directly or must first obtain a Syrian commercial registration / appoint a local agent.
2. **[OWNER ACTION]** Provide the Canadian corporate-registration certificate (and a certified Arabic translation if needed).
3. **[OWNER ACTION]** Create the `support@ / legal@ / privacy@ sybnb.app` mailboxes.
4. Team completes §§3–10 attachments from existing SYBNB documentation.
5. Do **not** submit or claim approval until the Authority confirms the procedure. Keep `publicAccess=CLOSED`, `payments=DISABLED`.
