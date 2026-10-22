import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  fetchStayPricingAdmin,
  previewStayPricingAdmin,
  saveStayPricingAdmin,
  type StayPricingConfig,
  type StayPricingExample,
  type StayPricingLimits,
  type StaySeason,
} from '../../shared/api/platformApi'
import { weekendNightNames } from '../host/StayPricingFields'

// Admin: stay variable pricing (2026-10-22). Weekend nights (when a host's weekend price applies) and
// high-season periods with a % uplift on the host's nightly price. Hosts set their own prices and
// discounts; a host can opt out of seasons. Saved with a reason, audited, version-checked (as SR).
type Props = { lang: Lang }

const DAYS = [0, 1, 2, 3, 4, 5, 6]

export function AdminStayPricingPage({ lang }: Props) {
  const [config, setConfig] = useState<StayPricingConfig | null>(null)
  const [limits, setLimits] = useState<StayPricingLimits | null>(null)
  const [version, setVersion] = useState(0)
  const [examples, setExamples] = useState<StayPricingExample[]>([])
  const [reason, setReason] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const previewTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    fetchStayPricingAdmin()
      .then((view) => {
        setConfig(view.config)
        setLimits(view.limits)
        setVersion(view.version)
        setExamples(view.examples)
        setState('ready')
      })
      .catch((error) => {
        setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not load stay pricing.' })
        setState('error')
      })
  }, [])

  function update(next: StayPricingConfig) {
    setConfig(next)
    setMessage(null)
    window.clearTimeout(previewTimer.current)
    previewTimer.current = window.setTimeout(() => {
      previewStayPricingAdmin(next).then((result) => setExamples(result.examples)).catch(() => undefined)
    }, 400)
  }

  function updateSeason(index: number, patch: Partial<StaySeason>) {
    if (!config) return
    update({ ...config, seasons: config.seasons.map((season, i) => (i === index ? { ...season, ...patch } : season)) })
  }

  function addSeason() {
    if (!config) return
    const today = new Date().toISOString().slice(0, 10)
    update({ ...config, seasons: [...config.seasons, { id: `s${Date.now().toString(36)}`, name: '', from: today, to: today, upliftPct: 15 }] })
  }

  async function save() {
    if (!config) return
    if (reason.trim().length < 8) {
      setMessage({ ok: false, text: pick(lang, 'اكتب سبباً من 8 أحرف على الأقل (يُحفظ في سجل التدقيق).', 'Write a reason of at least 8 characters (kept in the audit log).', 'Indiquez une raison d’au moins 8 caractères.') })
      return
    }
    setState('saving')
    try {
      const result = await saveStayPricingAdmin({ config, reason: reason.trim(), expectedVersion: version })
      setConfig(result.config)
      setVersion(result.version)
      setExamples(result.examples)
      setReason('')
      setMessage({ ok: true, text: pick(lang, 'تم الحفظ. تُطبق على عروض الأسعار الجديدة خلال ثوانٍ.', 'Saved. Applies to new quotes within seconds.', 'Enregistré. S’applique aux nouveaux devis sous quelques secondes.') })
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not save.' })
    }
    setState('ready')
  }

  const dayName = (day: number) => weekendNightNames([day], lang)
  const money = (value: number) => `${value.toLocaleString(lang === 'ar' ? 'ar-SY' : 'en-US')} SYP`

  return (
    <main style={S.page} dir={lang === 'ar' ? 'rtl' : 'ltr'} data-testid="admin-stay-pricing">
      <h1 style={S.title}>{pick(lang, 'أسعار الإقامات', 'Stay pricing', 'Tarifs des séjours')}</h1>
      <p style={S.sub}>
        {pick(
          lang,
          'المضيف يحدد سعره وخصوماته (مثل Airbnb). هنا تحدد الإدارة ليالي نهاية الأسبوع ومواسم الذروة التي ترفع سعر الليلة بنسبة مئوية. المضيف يستطيع إيقاف المواسم لإعلانه، والسعر الخاص بتاريخ معين لا يتغير.',
          'Hosts set their own price and discounts (like Airbnb). Here admin sets the weekend nights and the high seasons that raise the nightly price by a %. A host can turn seasons off for their stay, and a host’s price for a specific date is never changed.',
          'Les hôtes fixent leurs prix et remises. L’administration définit ici les nuits de week-end et les hautes saisons (hausse en %). Un hôte peut refuser les saisons ; un prix fixé pour une date n’est jamais modifié.',
        )}
      </p>
      {state === 'loading' && <p style={S.sub}>{pick(lang, 'جار التحميل…', 'Loading…', 'Chargement…')}</p>}
      {config && limits && (
        <>
          <section style={S.card}>
            <strong>{pick(lang, 'ليالي نهاية الأسبوع', 'Weekend nights', 'Nuits de week-end')}</strong>
            <span style={S.hint}>{pick(lang, 'الليالي التي يُطبق فيها سعر نهاية الأسبوع الذي يحدده المضيف.', 'Nights when a host’s weekend price applies.', 'Nuits où le prix week-end de l’hôte s’applique.')}</span>
            <div style={S.row}>
              {DAYS.map((day) => {
                const on = config.weekendNights.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    data-testid={`weekend-night-${day}`}
                    style={{ ...S.btn, ...(on ? S.btnOn : null) }}
                    onClick={() => update({ ...config, weekendNights: on ? config.weekendNights.filter((d) => d !== day) : [...config.weekendNights, day].sort() })}
                  >
                    {dayName(day)}
                  </button>
                )
              })}
            </div>
          </section>

          <section style={S.card}>
            <strong>{pick(lang, 'مواسم الذروة', 'High seasons', 'Hautes saisons')}</strong>
            <span style={S.hint}>
              {pick(lang, `حتى ${limits.maxSeasons} موسماً، زيادة حتى ${limits.maxSeasonUpliftPct}٪. عند التداخل تُطبق أعلى نسبة فقط.`, `Up to ${limits.maxSeasons} seasons, uplift up to ${limits.maxSeasonUpliftPct}%. When seasons overlap, only the highest applies.`, `Jusqu’à ${limits.maxSeasons} saisons, hausse max ${limits.maxSeasonUpliftPct} %. En cas de chevauchement, la plus haute s’applique.`)}
            </span>
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>{pick(lang, 'الاسم', 'Name', 'Nom')}</th>
                    <th style={S.th}>{pick(lang, 'من', 'From', 'Du')}</th>
                    <th style={S.th}>{pick(lang, 'إلى (شاملة)', 'To (inclusive)', 'Au (inclus)')}</th>
                    <th style={S.th}>{pick(lang, 'زيادة ٪', 'Uplift %', 'Hausse %')}</th>
                    <th style={S.th} />
                  </tr>
                </thead>
                <tbody>
                  {config.seasons.map((season, index) => (
                    <tr key={season.id} data-testid="season-row">
                      <td style={S.td}>
                        <input style={{ ...S.cellInput, width: 160 }} data-testid="season-name" value={season.name} placeholder={pick(lang, 'عيد الأضحى', 'Eid al-Adha', 'Aïd al-Adha')} onChange={(event) => updateSeason(index, { name: event.target.value })} />
                      </td>
                      <td style={S.td}>
                        <input style={{ ...S.cellInput, width: 140 }} data-testid="season-from" type="date" value={season.from} onChange={(event) => updateSeason(index, { from: event.target.value })} />
                      </td>
                      <td style={S.td}>
                        <input style={{ ...S.cellInput, width: 140 }} data-testid="season-to" type="date" value={season.to} onChange={(event) => updateSeason(index, { to: event.target.value })} />
                      </td>
                      <td style={S.td}>
                        <input style={S.cellInput} data-testid="season-uplift" dir="ltr" inputMode="numeric" value={String(season.upliftPct)} onChange={(event) => updateSeason(index, { upliftPct: Number(event.target.value.replace(/[^\d]/g, '')) || 0 })} />
                      </td>
                      <td style={S.td}>
                        <button type="button" style={S.btn} onClick={() => update({ ...config, seasons: config.seasons.filter((_, i) => i !== index) })}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {config.seasons.length < limits.maxSeasons && (
              <div>
                <button type="button" style={S.btn} data-testid="season-add" onClick={addSeason}>
                  + {pick(lang, 'إضافة موسم', 'Add season', 'Ajouter une saison')}
                </button>
              </div>
            )}
          </section>

          <section style={S.card}>
            <strong>{pick(lang, 'أمثلة', 'Examples', 'Exemples')}</strong>
            <span style={S.hint}>
              {pick(lang, 'إعلان سعره 100,000 لليلة و130,000 لنهاية الأسبوع، خصم أسبوعي 10٪.', 'A listing at 100,000/night, 130,000 on weekend nights, 10% weekly discount.', 'Annonce à 100 000/nuit, 130 000 le week-end, remise semaine 10 %.')}
            </span>
            <div style={S.tableWrap}>
              <table style={S.table} data-testid="stay-pricing-examples">
                <tbody>
                  {examples.map((example) => (
                    <tr key={example.label}>
                      <td style={S.td}>{example.label}</td>
                      <td style={S.td} dir="ltr">{example.from}</td>
                      <td style={S.td} dir="ltr">{money(example.subtotalMinor)}</td>
                      <td style={S.td} dir="ltr">{example.discountMinor ? `-${money(example.discountMinor)}` : ''}</td>
                      <td style={{ ...S.td, fontWeight: 900 }} dir="ltr">{money(example.totalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={S.card}>
            <label style={S.field}>
              <span>{pick(lang, 'سبب التغيير (يُحفظ في سجل التدقيق)', 'Reason for the change (kept in the audit log)', 'Raison du changement (journal d’audit)')}</span>
              <input style={{ ...S.input, width: '100%' }} data-testid="stay-pricing-reason" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
            </label>
            <button type="button" style={S.primary} data-testid="stay-pricing-save" disabled={state === 'saving'} onClick={() => void save()}>
              {state === 'saving' ? pick(lang, 'جار الحفظ…', 'Saving…', 'Enregistrement…') : pick(lang, 'حفظ', 'Save', 'Enregistrer')}
            </button>
          </section>
        </>
      )}
      {message && <p style={message.ok ? S.ok : S.err} data-testid="stay-pricing-message">{message.text}</p>}
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
  field: { display: 'grid', gap: 4, fontSize: 14 },
  input: { minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit', minWidth: 0 },
  tableWrap: { overflowX: 'auto' },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 14 },
  th: { textAlign: 'start', color: '#9aa6ba', fontWeight: 700, padding: '6px 8px', borderBottom: '1px solid #1e2a3c', whiteSpace: 'nowrap' },
  td: { padding: '6px 8px', borderBottom: '1px solid #16202f', whiteSpace: 'nowrap' },
  cellInput: { width: 84, minHeight: 34, border: '1px solid #263651', borderRadius: 6, background: '#070b12', color: '#fff', padding: '0 6px', colorScheme: 'dark' },
  primary: { minHeight: 46, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950 },
  ok: { color: '#20d29b', margin: 0 },
  err: { color: '#ff8aa0', margin: 0 },
}
