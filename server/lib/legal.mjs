// Legal document manifest + versioning. The DOCUMENT TEXT is owner/legal-supplied and is NOT
// invented here. Each entry carries a version and a status:
//   'DRAFT'     — placeholder; owner/legal content required. LAUNCH-BLOCKING.
//   'PUBLISHED' — owner-approved content is in place at the given version.
//
// To publish real content, the owner sets status:'PUBLISHED', bumps the version, and supplies the
// rendered text (served by the frontend legal pages / a CMS). Consent is recorded against the
// version (see LegalConsent), so republishing a document can require re-consent.
export const LEGAL_DOCUMENTS = {
  terms: {
    key: 'terms',
    title: { en: 'Terms of Service', ar: 'شروط الخدمة' },
    version: '0.0.0-draft',
    status: 'DRAFT',
    ownerApprovalRequired: true,
  },
  privacy: {
    key: 'privacy',
    title: { en: 'Privacy Policy', ar: 'سياسة الخصوصية' },
    version: '0.0.0-draft',
    status: 'DRAFT',
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
    status: d.status,
    ownerApprovalRequired: d.ownerApprovalRequired,
  }))
  // Launch is blocked while any launch-facing legal document is still a DRAFT placeholder.
  const launchBlocking = documents.some((d) => d.status !== 'PUBLISHED')
  return { documents, launchBlocking }
}
