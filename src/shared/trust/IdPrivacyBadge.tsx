import { pick, type Lang } from '../../engines/language/languageEngine'
import { BRAND_NAME, IS_PLATFORM_BRAND } from '../brand/brandName'

// Shown next to every ID / passport / driver-licence upload. Accurate to how the platform works:
// identity files sit in private storage and are opened only by SYBNB admin verification, via
// short-lived signed links. Hosts, drivers and other guests have no route to them.
export function IdPrivacyBadge({ lang }: { lang: Lang }) {
  return (
    <div
      role="note"
      data-testid="id-privacy-badge"
      style={{
        display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 12px', margin: '8px 0',
        borderRadius: 10, border: '1px solid #bfe3cf', background: '#eefaf3', color: '#14532d', fontSize: 13, lineHeight: 1.5,
      }}
    >
      <span aria-hidden="true">🔒</span>
      <span>
        {pick(
          lang,
          IS_PLATFORM_BRAND ? 'تُشارَك فقط مع فريق التحقق في سيبنب. لا يراها أي مضيف أو سائق أو ضيف آخر أبداً.' : `تُشارَك فقط مع فريق التحقق في ${BRAND_NAME}. لا يراها أي مضيف أو سائق أو ضيف آخر أبداً.`,
          `Shared with ${BRAND_NAME} admin verification only. Never visible to hosts, drivers or other guests.`,
          `Partagé uniquement avec la vérification ${BRAND_NAME}. Jamais visible par les hôtes, chauffeurs ou autres voyageurs.`,
        )}
      </span>
    </div>
  )
}
