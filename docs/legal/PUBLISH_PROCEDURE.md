# SYBNB — Legal Publication Procedure (prepared; NOT executed)

The wiring is ready so publication is a small, reviewable edit the moment **counsel-approved final
text + version + effective date** arrive. **Nothing is published now** — `server/lib/legal.mjs` stays
`DRAFT` / launch-blocking, and the agent will not invent legal content. This file is the exact,
pre-written change to apply on approval.

## Inputs required from counsel/owner (all four, per document)
1. Final rendered **Terms of Service** text (en + ar) — where the frontend legal page will serve it.
2. Final rendered **Privacy Policy** text (en + ar).
3. **Version** for each (owner decision #24 says start at `1.0`).
4. **Effective date** (inserted at authorized publication).

## Step 1 — place the approved content
Put the counsel-approved rendered text where the frontend legal pages read it (CMS or the legal page
source). The manifest tracks version/status; the **text itself is owner/legal-supplied**, never authored here.

## Step 2 — flip the manifest (the exact diff)
In `server/lib/legal.mjs`, for each approved document change only these fields:
```diff
   terms: {
     key: 'terms',
     title: { en: 'Terms of Service', ar: 'شروط الخدمة' },
-    version: '0.0.0-draft',
-    status: 'DRAFT',
+    version: '1.0',
+    status: 'PUBLISHED',
+    effectiveDate: '<YYYY-MM-DD from counsel>',
     ownerApprovalRequired: true,
   },
```
Repeat for `privacy`. `legalManifest()` sets `launchBlocking = documents.some(d => d.status !== 'PUBLISHED')`,
so once both are `PUBLISHED` the launch-blocking flag clears automatically — no other code change.

## Step 3 — update the governed test
In `tests/e2e/legal-consent.e2e.mjs`, the suite currently asserts DRAFT/launch-blocking. On publish,
update the expectation to: manifest reports `terms` and `privacy` as `PUBLISHED` at the approved
version, `launchBlocking === false`, and consent is recorded **against the new version** (re-consent
path). Then:
```bash
npm run test:e2e:legal        # expect: PUBLISHED, launchBlocking=false, versioned consent green
bash scripts/run-all-e2e.sh   # full regression stays green
```

## Step 4 — record + commit
- Record the version + effective date + counsel sign-off reference in `OWNER_DECISIONS_RECORDED.md` (#24).
- Commit as a **separate** runtime change; the runtime candidate SHA advances (publication IS a code change).
- Re-issue the release manifest with the new SHA and updated `legal.mjs` checksum.

## What stays blocked until this runs
Publishing legal content is a **reserved action requiring explicit owner authorization** with the
approved text in hand. Until Steps 1–4 complete, legal remains DRAFT and the platform stays
CONDITIONAL GO on the legal gate.
