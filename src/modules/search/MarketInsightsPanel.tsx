import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { fetchMarketInsights, type MarketInsights } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'

// Market insights (Centris-depth, 2026-10-11). Average/median asking price for the active division
// and city, computed from live listings (no sold data yet — stated in the disclaimer).
export function MarketInsightsPanel({ division, city, currency = 'USD', lang }: { division: string; city?: string; currency?: string; lang: Lang }) {
  const isAr = lang === 'ar'
  const [data, setData] = useState<MarketInsights | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let on = true
    fetchMarketInsights({ division, city, currency }).then((d) => { if (on) setData(d) }).catch(() => {})
    return () => { on = false }
  }, [division, city, currency])

  if (!data || !data.overall || data.overall.count < 1) return null
  const o = data.overall

  return (
    <section style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <button type="button" style={styles.head} onClick={() => setOpen((v) => !v)}>
        <span style={styles.title}>📊 {pick(lang, 'مؤشرات السوق', 'Market insights', 'Indicateurs du marché')}{city ? ` · ${city}` : ''}</span>
        <span style={styles.toggle}>{open ? '▲' : '▼'}</span>
      </button>
      <div style={styles.statsRow}>
        <div style={styles.stat}><span style={styles.statLabel}>{pick(lang, 'متوسط السعر', 'Average', 'Moyenne')}</span><strong style={styles.statVal} dir={isAr ? 'rtl' : 'ltr'}>{moneyText(o.avg, data.currency, lang)}</strong></div>
        <div style={styles.stat}><span style={styles.statLabel}>{pick(lang, 'الوسيط', 'Median', 'Médiane')}</span><strong style={styles.statVal} dir={isAr ? 'rtl' : 'ltr'}>{moneyText(o.median, data.currency, lang)}</strong></div>
        <div style={styles.stat}><span style={styles.statLabel}>{pick(lang, 'عدد الإعلانات', 'Listings', 'Annonces')}</span><strong style={styles.statVal}>{o.count}</strong></div>
      </div>
      {open && data.byArea.length > 0 && (
        <div style={styles.areas}>
          {data.byArea.slice(0, 8).map((a) => (
            <div key={a.area} style={styles.areaRow}>
              <span style={styles.areaName}>{a.area}</span>
              <span style={styles.areaStat} dir={isAr ? 'rtl' : 'ltr'}>{moneyText(a.median, data.currency, lang)} · {a.count}</span>
            </div>
          ))}
        </div>
      )}
      <small style={styles.disc}>{pick(lang, 'بناءً على أسعار الطلب للإعلانات النشطة، وليست صفقات مكتملة.', 'Based on asking prices of active listings, not completed sales.', 'Basé sur les prix demandés des annonces actives, pas des ventes conclues.')}</small>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 8, padding: 14, borderRadius: 14, border: '1px solid #e4e9f2', background: '#f8fafc', margin: '4px 0 14px' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: 0, width: '100%' },
  title: { fontSize: 15, fontWeight: 700, color: '#0b1b3b' },
  toggle: { color: '#64748b', fontSize: 12 },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 },
  stat: { display: 'grid', gap: 2, textAlign: 'center', background: '#fff', borderRadius: 10, padding: '10px 6px', border: '1px solid #e9eef5' },
  statLabel: { fontSize: 12, color: '#64748b' },
  statVal: { fontSize: 16, color: '#0b1b3b' },
  areas: { display: 'grid', gap: 4, marginTop: 4 },
  areaRow: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '6px 8px', borderRadius: 8, background: '#fff' },
  areaName: { color: '#334155', fontWeight: 600 },
  areaStat: { color: '#64748b' },
  disc: { color: '#94a3b8', fontSize: 11 },
}
