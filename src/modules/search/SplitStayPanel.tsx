import { useEffect, useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { fetchSplitStay, type SplitStayLeg, type SplitStayResult } from '../../shared/api/platformApi'

// "Stay a bit here, a bit there": when no single stay in the chosen city is free for the whole date
// range, offer two stays that cover it back to back. Nothing is reserved; each part is opened and
// booked through the normal listing page, with its own quote, availability check and payment.
type Props = { lang: Lang; city: string; checkIn: string; checkOut: string }

function legTitle(leg: SplitStayLeg, lang: Lang) {
  return (lang === 'ar' ? leg.titleAr || leg.titleEn : leg.titleEn || leg.titleAr) || '—'
}

export function SplitStayPanel({ lang, city, checkIn, checkOut }: Props) {
  const [data, setData] = useState<SplitStayResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!city || !checkIn || !checkOut) { setData(null); return }
    setLoading(true)
    fetchSplitStay(city, checkIn, checkOut)
      .then((r) => { if (!cancelled) setData(r) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [city, checkIn, checkOut])

  // Only useful when nothing covers the whole range.
  if (loading || !data || data.singles.length > 0 || data.pairs.length === 0) return null

  const open = (id: string) => { window.location.hash = `/listing/${id}` }
  const money = (minor: number, currency: string) => `${minor.toLocaleString(lang === 'ar' ? 'ar' : lang)} ${currency}`

  return (
    <section aria-label="split-stay" style={{ margin: '16px 0', padding: 16, border: '1px solid #c9d3e6', borderRadius: 14, background: '#f6f9ff' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>
        {pick(lang, 'لا يوجد مكان واحد متاح لكل المدة — جرّب الإقامة على جزأين', 'No single stay is free for your whole trip — try splitting it', 'Aucun logement libre pour tout le séjour — essayez de le diviser')}
      </h3>
      <p style={{ margin: '0 0 12px', color: '#52607a', fontSize: 13 }}>
        {pick(lang, 'كل جزء يُحجز على حدة وبسعره وتأكيده الخاص.', 'Each part is booked separately, with its own price and confirmation.', 'Chaque partie se réserve séparément, avec son propre prix et sa confirmation.')}
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        {data.pairs.map((pair) => (
          <div key={`${pair.first.id}-${pair.second.id}`} style={{ display: 'grid', gap: 8, padding: 12, background: '#fff', borderRadius: 10, border: '1px solid #e1e7f2' }}>
            {[pair.first, pair.second].map((leg, idx) => (
              <div key={leg.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ minWidth: 70 }}>{pick(lang, `الجزء ${idx + 1}`, `Part ${idx + 1}`, `Partie ${idx + 1}`)}</strong>
                <span style={{ flex: 1, minWidth: 160 }}>
                  {legTitle(leg, lang)}
                  <small style={{ display: 'block', color: '#52607a' }}>
                    {leg.checkIn} → {leg.checkOut} · {pick(lang, `${leg.nights} ليالٍ`, `${leg.nights} night${leg.nights === 1 ? '' : 's'}`, `${leg.nights} nuit${leg.nights === 1 ? '' : 's'}`)} · {money(leg.priceMinor, leg.currency)} / {pick(lang, 'ليلة', 'night', 'nuit')}
                  </small>
                </span>
                <button type="button" onClick={() => open(leg.id)} style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid #0b1b3b', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                  {pick(lang, 'عرض وحجز', 'View & book', 'Voir et réserver')}
                </button>
              </div>
            ))}
            <small style={{ color: '#52607a' }}>
              {pick(lang, 'تقدير الإجمالي', 'Estimated total', 'Total estimé')}: {money(pair.estimateMinor, pair.first.currency)} — {pick(lang, 'تقدير بسعر الليلة فقط', 'nightly-rate estimate only', 'estimation au tarif nuitée seulement')}
            </small>
          </div>
        ))}
      </div>
    </section>
  )
}
