import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { moneyText } from '../../shared/i18n/display'

type Props = { priceMinor: number; currency: string; lang: Lang }

// Syria-appropriate installment / affordability calculator (the Centris listing has a Canadian
// mortgage calculator; this is the local equivalent). Down payment %, number of monthly installments,
// and an optional annual profit/markup rate (0 = interest-free installments, common locally).
// Pure client-side — no backend, no stored data.
export function AffordabilityCalculator({ priceMinor, currency, lang }: Props) {
  const isAr = lang === 'ar'
  const [downPct, setDownPct] = useState(30)
  const [months, setMonths] = useState(24)
  const [rate, setRate] = useState(0)

  const calc = useMemo(() => {
    const price = Math.max(0, Number(priceMinor) || 0)
    const down = Math.round((price * downPct) / 100)
    const financed = Math.max(0, price - down)
    const m = Math.max(1, Math.round(months))
    const r = Math.max(0, Number(rate) || 0) / 100
    let monthly: number
    if (r > 0) {
      const i = r / 12
      monthly = (financed * i) / (1 - Math.pow(1 + i, -m))
    } else {
      monthly = financed / m
    }
    monthly = Math.round(monthly)
    const total = down + monthly * m
    return { down, financed, monthly, total, m }
  }, [priceMinor, downPct, months, rate])

  return (
    <section style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'} aria-label={pick(lang, 'حاسبة الأقساط', 'Installment calculator', 'Calculateur')}>
      <strong style={styles.title}>{pick(lang, 'حاسبة الأقساط', 'Estimate your installments', 'Estimez vos versements')}</strong>

      <div style={styles.controls}>
        <label style={styles.field}>
          <span>{pick(lang, `الدفعة الأولى: ${downPct}%`, `Down payment: ${downPct}%`, `Acompte : ${downPct}%`)}</span>
          <input type="range" min={0} max={90} step={5} value={downPct} onChange={(e) => setDownPct(Number(e.target.value))} />
        </label>
        <label style={styles.field}>
          <span>{pick(lang, 'عدد الأشهر', 'Number of months', 'Nombre de mois')}</span>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} dir="ltr">
            {[6, 12, 24, 36, 48, 60, 120].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label style={styles.field}>
          <span>{pick(lang, 'نسبة ربح سنوية % (اختياري)', 'Annual rate % (optional)', 'Taux annuel % (opt.)')}</span>
          <input type="number" min={0} max={40} step={0.5} value={rate} onChange={(e) => setRate(Number(e.target.value))} dir="ltr" style={styles.num} />
        </label>
      </div>

      <div style={styles.result}>
        <div style={styles.big}>
          <span style={styles.bigLabel}>{pick(lang, 'القسط الشهري', 'Monthly payment', 'Mensualité')}</span>
          <strong style={styles.bigValue}>{moneyText(calc.monthly, currency, lang)}</strong>
          <span style={styles.perMonth}>/ {pick(lang, 'شهر', 'month', 'mois')}</span>
        </div>
        <div style={styles.rows}>
          <Row label={pick(lang, 'الدفعة الأولى', 'Down payment', 'Acompte')} value={moneyText(calc.down, currency, lang)} />
          <Row label={pick(lang, 'المبلغ المقسّط', 'Financed amount', 'Montant financé')} value={moneyText(calc.financed, currency, lang)} />
          <Row label={pick(lang, `الإجمالي على ${calc.m} شهر`, `Total over ${calc.m} months`, `Total sur ${calc.m} mois`)} value={moneyText(calc.total, currency, lang)} />
        </div>
      </div>

      <small style={styles.disclaimer}>{pick(lang, 'تقدير إرشادي فقط — تُتفق الشروط النهائية مباشرة مع البائع.', 'Indicative estimate only — final terms are agreed directly with the seller.', 'Estimation indicative — les conditions finales sont convenues avec le vendeur.')}</small>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { border: '1px solid #e4e9f2', borderRadius: 16, padding: 16, background: '#fbfcff', display: 'grid', gap: 14, marginTop: 16 },
  title: { fontSize: 16, color: '#0b1b3b' },
  controls: { display: 'grid', gap: 12 },
  field: { display: 'grid', gap: 6, fontSize: 13, color: '#334155' },
  num: { padding: '8px 10px', borderRadius: 8, border: '1px solid #c9d3e6', width: 120 },
  result: { display: 'grid', gap: 12, background: '#fff', borderRadius: 12, padding: 14, border: '1px solid #eef1f7' },
  big: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  bigLabel: { fontSize: 13, color: '#60708a' },
  bigValue: { fontSize: 26, fontWeight: 800, color: '#0b1b3b' },
  perMonth: { color: '#60708a' },
  rows: { display: 'grid', gap: 6, borderTop: '1px solid #eef1f7', paddingTop: 10 },
  row: { display: 'flex', justifyContent: 'space-between', fontSize: 14 },
  rowLabel: { color: '#60708a' },
  disclaimer: { color: '#94a3b8', fontSize: 12 },
}
