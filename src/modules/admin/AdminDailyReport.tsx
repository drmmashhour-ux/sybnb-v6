import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { moneyText } from '../../shared/i18n/display'
import { fetchAdminDailyReport, type AdminDailyReport } from '../../shared/api/platformApi'

const C = {
  panel: 'linear-gradient(180deg,#111b2e,#0c1322)',
  line: 'rgba(130,150,200,.14)',
  text: '#f2f5ff',
  muted: '#9aa7bd',
  dim: '#6c7b96',
  green: '#22d6a0',
  red: '#ff5c7a',
  gold: '#e8bd2a',
  cyan: '#19d7ff',
}

function localTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}
function todayIn(tz: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) } catch { return new Date().toISOString().slice(0, 10) }
}
const TZ_CHOICES = ['America/Toronto', 'Asia/Damascus', 'UTC']

export function AdminDailyReport({ lang }: { lang: Lang }) {
  const [tz, setTz] = useState<string>(() => { const l = localTz(); return TZ_CHOICES.includes(l) ? l : TZ_CHOICES[0] })
  const [date, setDate] = useState<string>(() => todayIn(TZ_CHOICES[0]))
  const [data, setData] = useState<AdminDailyReport | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetchAdminDailyReport({ date, tz })
      .then((r) => { if (!cancelled) { setData(r); setState('ready') } })
      .catch((e) => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setState('error') } })
    return () => { cancelled = true }
  }, [date, tz])

  const t = {
    title: pick(lang, 'التقرير المالي اليومي', 'Daily money in / money out', 'Rapport financier quotidien'),
    sub: pick(lang, 'كل مبلغ دخل أو خرج من المنصة في اليوم المحدد، حسب وسيلة الدفع.', 'Every amount that entered or left the platform on the chosen day, by payment method.', 'Chaque montant entré ou sorti de la plateforme ce jour-là, par mode de paiement.'),
    in: pick(lang, 'أموال داخلة', 'Money in', 'Argent entrant'),
    out: pick(lang, 'أموال خارجة', 'Money out', 'Argent sortant'),
    net: pick(lang, 'الصافي الخارجي', 'Net (in − out)', 'Net (entrées − sorties)'),
    closing: pick(lang, 'أرصدة المحافظ (إغلاق)', 'Wallet balances (close)', 'Soldes portefeuilles (clôture)'),
    inByMethod: pick(lang, 'الداخل حسب الوسيلة', 'Money in by method', 'Entrées par mode'),
    outByMethod: pick(lang, 'الخارج (دفعات مدفوعة)', 'Money out (paid payouts)', 'Sorties (paiements versés)'),
    internal: pick(lang, 'حركات داخل المنصة', 'Movements inside the platform', 'Mouvements internes'),
    none: pick(lang, 'لا شيء', 'Nothing', 'Rien'),
    opening: pick(lang, 'افتتاح', 'Opening', 'Ouverture'),
    test: pick(lang, 'رصيد تجريبي (ليس مالاً حقيقياً)', 'Test credits (not real money)', 'Crédits de test (pas de l’argent réel)'),
    warn: pick(lang, 'أحداث دفع لم تُسجَّل في الدفتر', 'Payment events NOT booked in the ledger', 'Événements de paiement NON comptabilisés'),
    day: pick(lang, 'اليوم', 'Day', 'Jour'),
    zone: pick(lang, 'المنطقة الزمنية', 'Time zone', 'Fuseau'),
    loading: pick(lang, 'جار التحميل…', 'Loading…', 'Chargement…'),
  }
  const money = (minor: number, cur: string) => moneyText(minor, cur, lang)

  return (
    <section style={s.card}>
      <div style={s.head}>
        <div>
          <strong style={{ fontSize: 18 }}>{t.title}</strong>
          <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 13 }}>{t.sub}</p>
        </div>
        <div style={s.controls}>
          <label style={s.lbl}>{t.day}<input type="date" style={s.input} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          <label style={s.lbl}>{t.zone}
            <select style={s.input} value={tz} onChange={(e) => setTz(e.target.value)}>
              {TZ_CHOICES.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
        </div>
      </div>

      {state === 'loading' && <div style={{ color: C.dim }}>{t.loading}</div>}
      {state === 'error' && <div style={{ color: C.red }}>{error}</div>}
      {state === 'ready' && data && (
        <>
          {data.unbookedProviderEvents.length > 0 && (
            <div style={s.warn}>
              <strong>{t.warn}</strong>
              {data.unbookedProviderEvents.map((e, i) => <div key={i} style={{ fontSize: 13 }}>{e.provider} · {e.type} · {e.status} × {e.count}</div>)}
            </div>
          )}
          {data.report.length === 0 && <div style={{ color: C.dim }}>{t.none}</div>}
          {data.report.map((r) => (
            <div key={r.currency} style={{ display: 'grid', gap: 12 }}>
              <div style={s.kpis}>
                <Kpi label={`${t.in} · ${r.currency}`} value={money(r.moneyInTotalMinor, r.currency)} tone={C.green} />
                <Kpi label={`${t.out} · ${r.currency}`} value={money(r.moneyOutTotalMinor, r.currency)} tone={C.red} />
                <Kpi label={t.net} value={money(r.netExternalMinor, r.currency)} tone={C.cyan} />
                <Kpi label={t.closing} value={money(r.closingWalletMinor, r.currency)} tone={C.gold} sub={`${t.opening}: ${money(r.openingWalletMinor, r.currency)}`} />
              </div>
              <div style={s.cols}>
                <Table title={t.inByMethod} empty={t.none} rows={r.moneyIn.map((m) => [m.method, String(m.count), `+${money(m.totalMinor, r.currency)}`])} tone={C.green} />
                <Table title={t.outByMethod} empty={t.none} rows={r.moneyOut.map((m) => [m.method, String(m.count), `−${money(m.totalMinor, r.currency)}`])} tone={C.red} />
              </div>
              <Table title={t.internal} empty={t.none} rows={r.internal.map((m) => [`${m.referenceType} (${m.type})`, String(m.count), money(m.totalMinor, r.currency)])} tone={C.muted} />
              {r.testCreditsMinor > 0 && <div style={{ color: C.dim, fontSize: 12 }}>{t.test}: {money(r.testCreditsMinor, r.currency)}</div>}
            </div>
          ))}
        </>
      )}
    </section>
  )
}

function Kpi({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <article style={s.kpi}>
      <small style={{ color: C.dim, fontWeight: 700, fontSize: 11.5 }}>{label}</small>
      <strong style={{ color: tone, fontSize: 20, fontWeight: 900 }}>{value}</strong>
      {sub && <small style={{ color: C.dim, fontSize: 11 }}>{sub}</small>}
    </article>
  )
}

function Table({ title, rows, empty, tone }: { title: string; rows: string[][]; empty: string; tone: string }) {
  return (
    <div style={s.table}>
      <div style={{ color: C.muted, fontWeight: 800, fontSize: 12, marginBottom: 6 }}>{title}</div>
      {rows.length === 0 && <div style={{ color: C.dim, fontSize: 13 }}>{empty}</div>}
      {rows.map((r, i) => (
        <div key={i} style={s.trow}>
          <span>{r[0]}</span><span style={{ color: C.dim }}>×{r[1]}</span><strong style={{ color: tone }}>{r[2]}</strong>
        </div>
      ))}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  card: { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, display: 'grid', gap: 14, color: C.text },
  head: { display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' },
  controls: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  lbl: { display: 'grid', gap: 4, color: C.dim, fontSize: 11, fontWeight: 700 },
  input: { minHeight: 40, border: `1px solid ${C.line}`, borderRadius: 10, background: '#070b16', color: '#fff', padding: '0 10px', fontSize: 14, fontFamily: 'inherit' },
  kpis: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' },
  kpi: { background: 'rgba(130,150,200,.05)', border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, display: 'grid', gap: 6 },
  cols: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' },
  table: { background: 'rgba(130,150,200,.04)', border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 },
  trow: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, padding: '5px 0', fontSize: 13, borderTop: `1px solid ${C.line}` },
  warn: { border: '1px solid rgba(232,189,42,.5)', background: 'rgba(232,189,42,.08)', color: '#f3d672', borderRadius: 12, padding: 12, display: 'grid', gap: 4 },
}
