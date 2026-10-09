// Legal document manifest + versioning. The DOCUMENT TEXT lives in the frontend
// (src/modules/legal/legalContent.ts) and is rendered by the legal pages. Each entry here carries a
// version and a status:
//   'DRAFT'     — placeholder; owner/legal content required. LAUNCH-BLOCKING.
//   'PUBLISHED' — owner-approved content is in place at the given version.
//
// Consent is recorded against the version (see LegalConsent), so republishing a document at a new
// version can require re-consent. Keep version + effectiveDate in sync with legalContent.ts
// (LEGAL_VERSION / LEGAL_EFFECTIVE_DATE).
//
// v1.0.0 (2026-10-09): initial published content drafted to fit how SYBNB actually operates. This
// text is a strong starting point and should still be reviewed by a lawyer licensed in the Syrian
// Arab Republic; a review changes nothing here until the version is bumped on a content change.
const LEGAL_VERSION = '1.0.0'
const LEGAL_EFFECTIVE_DATE = '2026-10-09'

export const LEGAL_DOCUMENTS = {
  terms: {
    key: 'terms',
    title: { en: 'Terms of Service', ar: 'شروط الخدمة', fr: 'Conditions d’utilisation' },
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    status: 'PUBLISHED',
    ownerApprovalRequired: true,
  },
  privacy: {
    key: 'privacy',
    title: { en: 'Privacy Policy', ar: 'سياسة الخصوصية', fr: 'Politique de confidentialité' },
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    status: 'PUBLISHED',
    ownerApprovalRequired: true,
  },
  // The lister's understanding agreement: every host/seller must accept this (and pass ID verification)
  // before a listing can be published, in any division.
  'listing-agreement': {
    key: 'listing-agreement',
    title: { en: 'Listing Agreement', ar: 'اتفاقية النشر', fr: 'Accord de publication' },
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    status: 'PUBLISHED',
    ownerApprovalRequired: true,
  },
}

export function legalDocument(key) {
  return LEGAL_DOCUMENTS[key] || null
}

export function legalManifest() {
  const documents = Object.values(LEGAL_DOCUMENTS).map((d) => ({
    key: d.key,
    title: d.title,
    version: d.version,
    effectiveDate: d.effectiveDate,
    status: d.status,
    ownerApprovalRequired: d.ownerApprovalRequired,
  }))
  // Launch is blocked while any launch-facing legal document is still a DRAFT placeholder.
  const launchBlocking = documents.some((d) => d.status !== 'PUBLISHED')
  return { documents, launchBlocking }
}
