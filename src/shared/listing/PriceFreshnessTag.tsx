import { pick, type Lang } from '../../engines/language/languageEngine'
import { priceFreshness } from './priceFreshness'

export function PriceFreshnessTag({ listing, lang }: { listing: Parameters<typeof priceFreshness>[0]; lang: Lang }) {
  const f = priceFreshness(listing)
  if (!f.applies) return null
  const when = f.days === 0
    ? pick(lang, 'اليوم', 'today', 'aujourd’hui')
    : pick(lang, `منذ ${f.days} يوم`, `${f.days} day${f.days === 1 ? '' : 's'} ago`, `il y a ${f.days} jour${f.days === 1 ? '' : 's'}`)
  const text = f.confirmed
    ? pick(lang, `السعر مؤكَّد من المالك ${when}`, `Price confirmed by owner ${when}`, `Prix confirmé par le propriétaire ${when}`)
    : pick(lang, `تم نشر الإعلان ${when} — السعر غير مؤكَّد حديثاً`, `Listed ${when} — price not recently confirmed`, `Annonce publiée ${when} — prix non confirmé récemment`)
  return (
    <small
      data-testid="price-freshness"
      style={{ display: 'block', marginTop: 4, color: f.stale ? '#9a3412' : '#166534', fontWeight: 600 }}
    >
      {f.stale ? '⚠ ' : '✓ '}{text}
      {f.stale ? ` · ${pick(lang, 'اسأل المالك قبل الاعتماد عليه', 'ask the owner before relying on it', 'demandez au propriétaire avant de vous y fier')}` : ''}
    </small>
  )
}
