import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { fetchSrPricing, previewSrPricing, saveSrPricing, type SrPricingConfig, type SrPricingExamples, type SrPricingView } from '../../shared/api/platformApi'

type Props = { lang: Lang }
type Group = 'costs' | 'multipliers' | 'fees' | 'intercity'
type Field = { group: Group; key: string; ar: string; en: string; unit: string; step?: number }

// Every number the admin can change. The server clamps each one to the range in `limits`.
const FIELDS: Field[] = [
  { group: 'costs', key: 'fuelPriceUsdPerL', ar: 'سعر البنزين', en: 'Fuel price', unit: '$/L', step: 0.01 },
  { group: 'costs', key: 'maintenanceFactor', ar: 'عامل الصيانة (1 = عادي)', en: 'Maintenance factor (1 = normal)', unit: '×', step: 0.05 },
  { group: 'costs', key: 'resalePct', ar: 'قيمة السيارة المتبقية', en: 'Car resale value', unit: '%' },
  { group: 'costs', key: 'carLifeKm', ar: 'عمر السيارة', en: 'Car life', unit: 'km', step: 10000 },
  { group: 'costs', key: 'insuranceUsdPerKm', ar: 'التأمين', en: 'Insurance', unit: '$/km', step: 0.001 },
  { group: 'costs', key: 'safetyReserveUsdPerKm', ar: 'احتياطي السلامة', en: 'Safety reserve', unit: '$/km', step: 0.001 },
  { group: 'costs', key: 'emptyKmPct', ar: 'كم فارغ بدون راكب', en: 'Empty km (no passenger)', unit: '%' },
  { group: 'costs', key: 'driverIncomeUsdPerMonth', ar: 'دخل السائق المستهدف', en: 'Driver income target', unit: '$/month', step: 10 },
  { group: 'costs', key: 'hoursPerMonth', ar: 'ساعات العمل بالشهر', en: 'Working hours per month', unit: 'h' },
  { group: 'costs', key: 'utilizationPct', ar: 'نسبة الوقت في رحلات مدفوعة', en: 'Time on paid trips', unit: '%' },
  { group: 'costs', key: 'trafficUsdPerMin', ar: 'كلفة الازدحام', en: 'Traffic cost', unit: '$/min', step: 0.001 },
  { group: 'costs', key: 'platformFeePct', ar: 'عمولة المنصة', en: 'Platform fee', unit: '%' },
  { group: 'multipliers', key: 'peak', ar: 'ساعات الذروة', en: 'Rush hour (07-10, 16-20)', unit: '×', step: 0.01 },
  { group: 'multipliers', key: 'trafficMax', ar: 'أعلى ازدحام مباشر', en: 'Live traffic cap', unit: '×', step: 0.05 },
  { group: 'multipliers', key: 'night', ar: 'الليل (22-06)', en: 'Night (22-06)', unit: '×', step: 0.01 },
  { group: 'multipliers', key: 'schedule', ar: 'رحلة مجدولة', en: 'Scheduled ride', unit: '×', step: 0.01 },
  { group: 'multipliers', key: 'weekend', ar: 'الجمعة والسبت', en: 'Friday and Saturday', unit: '×', step: 0.01 },
  { group: 'multipliers', key: 'holiday', ar: 'العطل الرسمية', en: 'Public holidays', unit: '×', step: 0.01 },
  { group: 'multipliers', key: 'demand', ar: 'طلب مرتفع / طوارئ (يدوي)', en: 'High demand / emergency (manual)', unit: '×', step: 0.01 },
  { group: 'multipliers', key: 'fuelSurchargePercent', ar: 'زيادة وقود فورية', en: 'Instant fuel surcharge', unit: '%' },
  { group: 'fees', key: 'safetyFeePerTripUsd', ar: 'رسوم السلامة لكل رحلة', en: 'Safety fee per trip', unit: '$', step: 0.05 },
  { group: 'fees', key: 'liveTrackingUsd', ar: 'التتبع المباشر', en: 'Live tracking', unit: '$', step: 0.05 },
  { group: 'fees', key: 'ringFeeUsd', ar: 'رسوم كل حلقة حول دمشق', en: 'Fee per Damascus ring', unit: '$', step: 0.05 },
  { group: 'fees', key: 'ringWidthKm', ar: 'عرض الحلقة', en: 'Ring width', unit: 'km', step: 0.5 },
  { group: 'fees', key: 'ringCount', ar: 'عدد الحلقات', en: 'Number of rings', unit: '' },
  { group: 'fees', key: 'airportBaseUsd', ar: 'سعر المطار (اقتصادي من المركز)', en: 'Airport price (Economy from centre)', unit: '$' },
  { group: 'fees', key: 'airportSurchargeUsd', ar: 'إضافة المطار', en: 'Airport surcharge', unit: '$' },
  { group: 'fees', key: 'internationalSurchargeUsd', ar: 'إضافة عبور الحدود', en: 'Border-crossing surcharge', unit: '$' },
  { group: 'fees', key: 'stopFeeUsd', ar: 'رسوم كل توقف', en: 'Fee per stop', unit: '$', step: 0.25 },
  { group: 'fees', key: 'freeBags', ar: 'حقائب مجانية', en: 'Free bags', unit: '' },
  { group: 'fees', key: 'bagFeeUsd', ar: 'رسوم الحقيبة الإضافية', en: 'Fee per extra bag', unit: '$', step: 0.25 },
  { group: 'fees', key: 'baseRiders', ar: 'ركاب بلا رسوم', en: 'Riders included', unit: '' },
  { group: 'fees', key: 'extraRiderFeeUsd', ar: 'رسوم الراكب الإضافي', en: 'Fee per extra rider', unit: '$', step: 0.25 },
  { group: 'fees', key: 'minChargeUsd', ar: 'الحد الأدنى للرحلة (كل الفئات)', en: 'Minimum charge (all classes)', unit: '$' },
  { group: 'fees', key: 'roundingUsd', ar: 'تقريب السعر لأعلى', en: 'Round fare up to', unit: '$ (whole)' },
  { group: 'intercity', key: 'thresholdKm', ar: 'بعد هذه المسافة = رحلة بين المحافظات', en: 'Intercity starts after', unit: 'km' },
  { group: 'intercity', key: 'speedKmh', ar: 'متوسط السرعة على الطريق السريع', en: 'Highway average speed', unit: 'km/h' },
  { group: 'intercity', key: 'emptyKmPct', ar: 'كم فارغ في رحلة العودة', en: 'Empty km on the way back', unit: '%' },
]

const GROUPS: Array<{ id: Group; ar: string; en: string; hintAr: string; hintEn: string }> = [
  { id: 'costs', ar: 'تكاليف السائق', en: 'Driver costs (the formula inputs)', hintAr: 'تحدد الأسعار تلقائيًا في وضع المعادلة.', hintEn: 'These set the rates automatically in formula mode.' },
  { id: 'multipliers', ar: 'مضاعفات متغيرة', en: 'Variable multipliers', hintAr: 'للأحداث الطارئة: غيّر الطلب أو زيادة الوقود فورًا.', hintEn: 'For events: raise Demand or the fuel surcharge instantly.' },
  { id: 'fees', ar: 'رسوم ثابتة', en: 'Fixed fees and zones', hintAr: 'السلامة، الحلقات، المطار، الحدود، التقريب.', hintEn: 'Safety, rings, airport, border, rounding.' },
  { id: 'intercity', ar: 'بين المحافظات', en: 'Between governorates', hintAr: 'الكيلومترات بعد الحد تُسعّر بسعر الرحلات الطويلة.', hintEn: 'Km beyond the limit use the long-trip rate.' },
]

const TRIP_LABELS: Record<string, [string, string]> = {
  short: ['5 كم / 15 د', '5 km / 15 min'], medium: ['15 كم / 35 د', '15 km / 35 min'], long: ['32 كم / 45 د', '32 km / 45 min'],
  homs: ['حمص 162 كم', 'Homs 162 km'], aleppo: ['حلب 355 كم', 'Aleppo 355 km'],
}
const CLASS_LABELS: Record<string, [string, string]> = {
  'SR Bike': ['دراجة', 'Bike'], 'SR Economy': ['اقتصادي', 'Economy'], 'SR Comfort': ['مريح', 'Comfort'],
  'SR SUV': ['عائلي', 'SUV'], 'SR Van': ['فان', 'Van'], 'SR VIP': ['VIP', 'VIP'],
}

const copy = {
  ar: { title: 'الأسعار — سير', subtitle: 'كل أرقام التسعير هنا. غيّر رقمًا، شاهد الأسعار الجديدة، ثم احفظ مع سبب.', mode: 'طريقة التسعير', formula: 'معادلة التكلفة', manual: 'أسعار يدوية', loadRec: 'تحميل المعادلة الموصى بها', loadSaved: 'العودة للمحفوظ', rates: 'الأسعار الناتجة', cls: 'الفئة', base: 'الفتح', perKm: 'لكل كم', perKmLong: 'لكل كم (طويل)', perMin: 'لكل دقيقة', min: 'الحد الأدنى', examples: 'أمثلة (ظهرًا، يوم عادي)', reason: 'سبب التغيير (يُسجل)', save: 'حفظ الأسعار', saving: 'جار الحفظ...', saved: 'تم الحفظ. الأسعار الجديدة فعالة خلال ثوانٍ.', notStored: 'لا يوجد تسعير محفوظ: تعمل الأسعار القديمة.', stored: 'نسخة محفوظة', back: 'رجوع', loading: 'جار التحميل...', cost: 'تكلفة المركبة لكل كم', paidKm: 'لكل كم مدفوع', driverMin: 'السائق لكل دقيقة' },
  en: { title: 'Pricing — SR Ride', subtitle: 'Every pricing number is here. Change a number, see the new fares, then save with a reason.', mode: 'Pricing mode', formula: 'Cost formula', manual: 'Manual rates', loadRec: 'Load recommended formula', loadSaved: 'Back to saved', rates: 'Resulting rates', cls: 'Class', base: 'Base', perKm: 'Per km', perKmLong: 'Per km (long)', perMin: 'Per minute', min: 'Minimum', examples: 'Examples (noon, normal day)', reason: 'Reason for the change (audited)', save: 'Save pricing', saving: 'Saving...', saved: 'Saved. New prices are live within seconds.', notStored: 'Nothing saved yet: the old fixed prices are running.', stored: 'Saved version', back: 'Back', loading: 'Loading...', cost: 'Vehicle cost per km', paidKm: 'per paid km', driverMin: 'Driver per minute' },
  fr: { title: 'Tarifs — SR Ride', subtitle: 'Tous les chiffres de tarification. Changez un chiffre, voyez les prix, puis enregistrez avec un motif.', mode: 'Mode de tarification', formula: 'Formule de coût', manual: 'Tarifs manuels', loadRec: 'Charger la formule recommandée', loadSaved: 'Revenir à l’enregistré', rates: 'Tarifs obtenus', cls: 'Classe', base: 'Prise en charge', perKm: 'Par km', perKmLong: 'Par km (long)', perMin: 'Par minute', min: 'Minimum', examples: 'Exemples (midi, jour normal)', reason: 'Motif du changement (journalisé)', save: 'Enregistrer', saving: 'Enregistrement...', saved: 'Enregistré. Les nouveaux prix sont actifs en quelques secondes.', notStored: 'Rien d’enregistré : les anciens prix fixes tournent.', stored: 'Version enregistrée', back: 'Retour', loading: 'Chargement...', cost: 'Coût du véhicule par km', paidKm: 'par km payé', driverMin: 'Chauffeur par minute' },
}

// Render-style variable name, e.g. COSTS_FUEL_PRICE_USD_PER_L.
const varName = (f: Field) => `${f.group}_${f.key}`.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()

const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`

export function AdminPricingPage({ lang }: Props) {
  const t = copy[lang] ?? copy.en
  const en = (ar: string, e: string) => pick(lang, ar, e, e)
  const [view, setView] = useState<SrPricingView | null>(null)
  const [draft, setDraft] = useState<SrPricingConfig | null>(null)
  const [examples, setExamples] = useState<SrPricingExamples | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const seq = useRef(0)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    fetchSrPricing()
      .then((r) => { setView(r); setDraft(r.config); setExamples(r.examples) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load pricing'))
  }, [])

  // Live preview: every change asks the server to run the SAME engine on the draft.
  useEffect(() => {
    if (!draft || !view) return
    const mine = ++seq.current
    const timer = window.setTimeout(() => {
      previewSrPricing(draft)
        .then((r) => { if (mine === seq.current) { setExamples(r.examples); setDraft((d) => (d ? { ...d, rates: r.config.rates } : d)) } })
        .catch(() => undefined)
    }, 450)
    return () => window.clearTimeout(timer)
    // rates are written back from the preview itself, so they are not a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.mode, draft?.costs, draft?.multipliers, draft?.fees, draft?.intercity, draft?.manualRates, view])

  const limits = view?.limits
  const setValue = (group: Group, key: string, raw: string) => {
    setNotice('')
    const n = Number(raw)
    setDraft((d) => (d ? { ...d, [group]: { ...d[group], [key]: Number.isFinite(n) ? n : 0 } } : d))
  }
  const setManual = (cat: string, key: 'baseUsd' | 'perKmUsd' | 'perMinUsd' | 'minFareUsd', raw: string) => {
    setNotice('')
    const n = Number(raw)
    setDraft((d) => (d ? { ...d, manualRates: { ...d.manualRates, [cat]: { ...d.manualRates[cat], [key]: Number.isFinite(n) ? n : 0 } } } : d))
  }
  const dirty = useMemo(() => {
    if (!draft || !view) return false
    const strip = (c: SrPricingConfig) => JSON.stringify({ m: c.mode, c: c.costs, u: c.multipliers, f: c.fees, i: c.intercity, r: c.manualRates })
    return strip(draft) !== strip(view.config)
  }, [draft, view])

  async function save() {
    if (!draft || !view) return
    setSaving(true); setError(''); setNotice('')
    try {
      const r = await saveSrPricing({ config: draft, reason, expectedVersion: view.stored ? view.version : undefined })
      const fresh = await fetchSrPricing()
      setView(fresh); setDraft(fresh.config); setExamples(r.examples); setReason(''); setNotice(t.saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (error && !view) return <main style={S.page}><p style={S.err}>{error}</p></main>
  if (!view || !draft) return <main style={S.page}><p>{t.loading}</p></main>

  const cats = view.categories
  const isFormula = draft.mode === 'formula'
  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} style={S.page}>
      <h1 style={S.title}>{t.title}</h1>
      <p style={S.sub}>{t.subtitle}</p>
      <p style={S.sub}>{view.stored ? `${t.stored} ${view.version}` : t.notStored}</p>

      <section style={S.card}>
        <strong>{t.mode}</strong>
        <div style={S.row}>
          <button style={{ ...S.btn, ...(isFormula ? S.btnOn : null) }} onClick={() => setDraft({ ...draft, mode: 'formula' })}>{t.formula}</button>
          <button style={{ ...S.btn, ...(!isFormula ? S.btnOn : null) }} onClick={() => setDraft({ ...draft, mode: 'manual' })}>{t.manual}</button>
          <button style={S.btn} onClick={() => { setDraft(view.recommended); setNotice('') }}>{t.loadRec}</button>
          <button style={S.btn} onClick={() => { setDraft(view.config); setNotice('') }}>{t.loadSaved}</button>
        </div>
      </section>

      <input style={{ ...S.input, width: '100%', flex: 'none' }} dir="ltr" placeholder="Search variables… / ابحث…" value={filter} onChange={(e) => setFilter(e.target.value)} />

      {GROUPS.map((g) => {
        const rows = FIELDS.filter((f) => f.group === g.id && (!filter.trim() || `${varName(f)} ${f.en} ${f.ar}`.toLowerCase().includes(filter.trim().toLowerCase())))
        if (!rows.length) return null
        return (
          <section key={g.id} style={S.card}>
            <strong>{en(g.ar, g.en)}</strong>
            <span style={S.hint}>{en(g.hintAr, g.hintEn)}</span>
            <div style={S.vars}>
              {rows.map((f) => {
                const range = limits?.[f.group]?.[f.key]
                const saved = view.config[f.group][f.key]
                const changed = draft[f.group][f.key] !== saved
                return (
                  <div key={f.key} style={{ ...S.varRow, ...(changed ? S.varChanged : null) }}>
                    <div style={S.varName}>
                      <code dir="ltr" style={S.code}>{varName(f)}</code>
                      <small style={S.hint}>{en(f.ar, f.en)}{range ? ` · ${range[0]}–${range[1]}` : ''}</small>
                    </div>
                    <span style={S.inputWrap}>
                      <input type="number" inputMode="decimal" step={f.step ?? 1} min={range?.[0]} max={range?.[1]} dir="ltr" style={S.input}
                        value={draft[f.group][f.key] ?? ''} onChange={(e) => setValue(f.group, f.key, e.target.value)} />
                      <small dir="ltr" style={S.unit}>{f.unit}</small>
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      <section style={S.card}>
        <strong>{t.rates}</strong>
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr><th style={S.th}>{t.cls}</th><th style={S.th}>{t.base}</th><th style={S.th}>{t.perKm}</th><th style={S.th}>{t.perKmLong}</th><th style={S.th}>{t.perMin}</th><th style={S.th}>{t.min}</th>{isFormula && <th style={S.th}>{t.cost}</th>}</tr></thead>
            <tbody>
              {cats.map((cat) => {
                const r = draft.rates[cat]
                const m = draft.manualRates[cat]
                const lbl = CLASS_LABELS[cat] ?? [cat, cat]
                const cell = (key: 'baseUsd' | 'perKmUsd' | 'perMinUsd' | 'minFareUsd') => isFormula
                  ? <td style={S.td} dir="ltr">{r ? usd(r[key]) : ''}</td>
                  : <td style={S.td}><input type="number" step="0.01" dir="ltr" style={S.cellInput} value={m?.[key] ?? ''} onChange={(e) => setManual(cat, key, e.target.value)} /></td>
                return (
                  <tr key={cat}>
                    <td style={S.td}><strong>{en(lbl[0], lbl[1])}</strong></td>
                    {cell('baseUsd')}{cell('perKmUsd')}
                    <td style={S.td} dir="ltr">{r?.perKmIntercityUsd != null ? usd(r.perKmIntercityUsd) : ''}</td>
                    {cell('perMinUsd')}{cell('minFareUsd')}
                    {isFormula && <td style={S.td} dir="ltr">{r?.breakdown ? `${usd(r.breakdown.vehicleCostPerKm)} → ${usd(r.breakdown.costPerPaidKm)} ${t.paidKm}` : ''}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {isFormula && draft.rates[cats[1]]?.breakdown && <span style={S.hint}>{t.driverMin}: {usd(draft.rates[cats[1]].breakdown!.driverPerMin)}</span>}
      </section>

      {examples && (
        <section style={S.card}>
          <strong>{t.examples}</strong>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr><th style={S.th}>{t.cls}</th>{examples.trips.map((trip) => <th key={trip.key} style={S.th}>{en(TRIP_LABELS[trip.key]?.[0] ?? trip.key, TRIP_LABELS[trip.key]?.[1] ?? trip.key)}</th>)}</tr></thead>
              <tbody>
                {cats.map((cat) => (
                  <tr key={cat}>
                    <td style={S.td}><strong>{en((CLASS_LABELS[cat] ?? [cat, cat])[0], (CLASS_LABELS[cat] ?? [cat, cat])[1])}</strong></td>
                    {examples.trips.map((trip) => <td key={trip.key} style={S.td} dir="ltr">${examples.fares[cat]?.[trip.key]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section style={S.card}>
        <label style={S.field}>
          <span>{t.reason}</span>
          <input style={{ ...S.input, width: '100%' }} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button disabled={saving || !dirty || reason.trim().length < 8} style={S.primary} onClick={() => void save()}>{saving ? t.saving : t.save}</button>
        {notice && <p style={S.ok}>{notice}</p>}
        {error && <p style={S.err}>{error}</p>}
      </section>
    </main>
  )
}

const S: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 14, maxWidth: 980, margin: '0 auto', alignContent: 'start' },
  title: { margin: 0, fontSize: 28 },
  sub: { color: '#9aa6ba', margin: 0 },
  hint: { color: '#9aa6ba', fontSize: 13 },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 10, minWidth: 0 },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  btn: { minHeight: 40, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 12px' },
  btnOn: { background: '#19d7ff', color: '#051014', border: '1px solid #19d7ff' },
  vars: { display: 'grid', border: '1px solid #1e2a3c', borderRadius: 8, overflow: 'hidden' },
  varRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(150px, 220px)', gap: 12, alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #16202f', background: '#0b121c' },
  varChanged: { background: 'rgba(25,215,255,.08)', boxShadow: 'inset 3px 0 0 #19d7ff' },
  varName: { display: 'grid', gap: 2, minWidth: 0 },
  code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, color: '#e6edf7', overflowWrap: 'anywhere' },
  fields: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' },
  field: { display: 'grid', gap: 4, fontSize: 14 },
  inputWrap: { display: 'flex', alignItems: 'center', gap: 6 },
  input: { minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit', minWidth: 0, flex: 1 },
  unit: { color: '#9aa6ba', minWidth: 44 },
  tableWrap: { overflowX: 'auto' },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 14 },
  th: { textAlign: 'start', color: '#9aa6ba', fontWeight: 700, padding: '6px 8px', borderBottom: '1px solid #1e2a3c', whiteSpace: 'nowrap' },
  td: { padding: '6px 8px', borderBottom: '1px solid #16202f', whiteSpace: 'nowrap' },
  cellInput: { width: 84, minHeight: 34, border: '1px solid #263651', borderRadius: 6, background: '#070b12', color: '#fff', padding: '0 6px' },
  primary: { minHeight: 46, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, opacity: 1 },
  ok: { color: '#20d29b', margin: 0 },
  err: { color: '#ff8aa0', margin: 0 },
}
