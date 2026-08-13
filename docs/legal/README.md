# SYBNB — Legal documents (drafts + publish procedure)

These files are **DRAFTS for owner + legal review**, not published legal terms:

- `TERMS_OF_SERVICE.draft.md`
- `PRIVACY_POLICY.draft.md`

They were prepared as a starting point grounded in the platform's actual implemented behavior. They
are **not legal advice** and must be reviewed, corrected, and approved by qualified counsel
(including Syria-specific and cross-border considerations) before use. Every
`[[LEGAL/OWNER TO CONFIRM: …]]` marker is a required human decision.

## Status today
The versioned-consent system (`server/lib/legal.mjs`) reports `terms` and `privacy` as **`DRAFT`**,
and `legalManifest().launchBlocking === true`. Public launch remains blocked on legal content —
this is intentional and correct.

## To publish approved content (owner action, after legal sign-off)
1. Finalize the approved text and host the rendered content the frontend legal pages will show.
2. In `server/lib/legal.mjs`, for each document set `status: 'PUBLISHED'` and bump `version`
   (e.g. `'1.0.0'`).
3. Because consent is recorded against a specific version (`LegalConsent`), publishing a new version
   naturally allows requiring renewed consent.
4. Re-run `npm run test:e2e:legal` — it currently asserts DRAFT/launch-blocking; update those
   assertions to reflect the published state as part of the publish change.
5. Only then does the launch matrix's "Final legal content approved" item flip to YES.

**Do not** set `PUBLISHED` on unreviewed draft text — that would let a DRAFT masquerade as approved
legal terms.
