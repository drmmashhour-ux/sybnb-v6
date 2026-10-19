import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchDriverDocBlobUrl,
  fetchDriverReviewDocs,
  fetchDriverReviewQueue,
  issueDriverKeyCode,
  reviewAdminDriverVehicle,
  reviewDriverDoc,
  type DriverReviewDoc,
  type DriverReviewRow,
} from '../../shared/api/platformApi'

type Props = { lang: Lang }

// Admin side of the shared driver base (2026-10-19). One screen: a queue of drivers on the left, the
// selected driver on the right with every document, the car, and the key code. Compared with how
// Uber and Lyft run driver onboarding: one document at a time, a written reason on every rejection,
// documents that expire are flagged before they lapse, and a driver is not cleared until everything
// is approved. Rating warning follows the owner decision: average under 4.6.

const KINDS = [
  'LICENCE', 'REGISTRATION', 'INSURANCE', 'CRIMINAL_RECORD', 'MECHANIC_REPORT', 'EXPERIENCE',
  'CAR_PHOTO_FRONT', 'CAR_PHOTO_BACK', 'CAR_PHOTO_LEFT', 'CAR_PHOTO_RIGHT', 'CAR_PHOTO_INSIDE', 'CAR_PHOTO_BOOT',
] as const

const copy = {
  en: {
    back: 'Admin panel', title: 'Driver review', subtitle: 'Documents, car and key code for every driver. Shared by rides now and food later.',
    loading: 'Loading...', error: 'Could not load', empty: 'No drivers in this list.',
    fNeeds: 'Needs review', fExpiring: 'Expiring soon', fDuty: 'On duty', fLow: 'Low rating', fAll: 'All',
    pick: 'Pick a driver on the left.',
    notOnDuty: 'Not on duty', onDuty: 'On duty', toFix: 'to fix',
    car: 'Car', facts: 'Luggage and car facts', rating: 'Rating', noTrips: 'no ratings yet', lowWarn: 'Below 4.6',
    large: 'large bags', hand: 'hand bags', seats: 'seats', smoking: 'Smoking allowed', nonSmoking: 'Non-smoking',
    winter: 'Winter tyres', allSeason: 'All-season tyres', noTyres: 'Tyres not set',
    docs: 'Documents and photos', open: 'Open file', approve: 'Approve', reject: 'Reject',
    missing: 'Missing', inReview: 'In review', approved: 'Approved', rejected: 'Rejected', expires: 'Expires', expired: 'Expired',
    reason: 'Reason the driver will read', sendReject: 'Send rejection',
    carStatus: 'Car status', approveCar: 'Approve car', rejectCar: 'Reject car',
    key: 'Key code', keyHelp: 'Unlocks only when every document and the car are approved. The code shows once. The driver types it to start work.',
    issueKey: 'Issue key code', keyShown: 'Key code (show it to the driver now, it will not be shown again)', hasKey: 'A key code was already issued. Issuing again replaces it.',
    saved: 'Saved', blockedBy: 'Still blocking',
    kinds: {
      LICENCE: 'Driving licence', REGISTRATION: 'Car registration', INSURANCE: 'Insurance', CRIMINAL_RECORD: 'Criminal record check',
      MECHANIC_REPORT: 'Mechanic report', EXPERIENCE: 'Experience proof', CAR_PHOTO_FRONT: 'Car photo: front', CAR_PHOTO_BACK: 'Car photo: back',
      CAR_PHOTO_LEFT: 'Car photo: left side', CAR_PHOTO_RIGHT: 'Car photo: right side', CAR_PHOTO_INSIDE: 'Car photo: inside', CAR_PHOTO_BOOT: 'Car photo: boot',
    } as Record<string, string>,
  },
  ar: {
    back: 'لوحة الإدارة', title: 'مراجعة السائقين', subtitle: 'مستندات السائق وسيارته ورمز البدء. مشترك بين الرحلات الآن والطعام لاحقاً.',
    loading: 'جار التحميل...', error: 'تعذر التحميل', empty: 'لا يوجد سائقون في هذه القائمة.',
    fNeeds: 'بحاجة لمراجعة', fExpiring: 'تنتهي قريباً', fDuty: 'في الخدمة', fLow: 'تقييم منخفض', fAll: 'الكل',
    pick: 'اختر سائقاً من القائمة.',
    notOnDuty: 'خارج الخدمة', onDuty: 'في الخدمة', toFix: 'للإصلاح',
    car: 'السيارة', facts: 'الحقائب ومعلومات السيارة', rating: 'التقييم', noTrips: 'لا تقييمات بعد', lowWarn: 'أقل من 4.6',
    large: 'حقائب كبيرة', hand: 'حقائب يد', seats: 'مقاعد', smoking: 'التدخين مسموح', nonSmoking: 'ممنوع التدخين',
    winter: 'إطارات شتوية', allSeason: 'إطارات لكل المواسم', noTyres: 'الإطارات غير محددة',
    docs: 'المستندات والصور', open: 'فتح الملف', approve: 'اعتماد', reject: 'رفض',
    missing: 'ناقص', inReview: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض', expires: 'ينتهي', expired: 'منتهي',
    reason: 'السبب الذي سيقرأه السائق', sendReject: 'إرسال الرفض',
    carStatus: 'حالة السيارة', approveCar: 'اعتماد السيارة', rejectCar: 'رفض السيارة',
    key: 'رمز البدء', keyHelp: 'لا يفتح إلا بعد اعتماد كل المستندات والسيارة. يظهر الرمز مرة واحدة. يكتبه السائق ليبدأ العمل.',
    issueKey: 'إصدار رمز البدء', keyShown: 'رمز البدء (أعطه للسائق الآن، لن يظهر مرة أخرى)', hasKey: 'تم إصدار رمز سابقاً. الإصدار مجدداً يستبدله.',
    saved: 'تم الحفظ', blockedBy: 'ما زال يمنع',
    kinds: {
      LICENCE: 'رخصة القيادة', REGISTRATION: 'تسجيل السيارة', INSURANCE: 'التأمين', CRIMINAL_RECORD: 'السجل الجنائي',
      MECHANIC_REPORT: 'تقرير الميكانيك', EXPERIENCE: 'إثبات الخبرة', CAR_PHOTO_FRONT: 'صورة السيارة: أمام', CAR_PHOTO_BACK: 'صورة السيارة: خلف',
      CAR_PHOTO_LEFT: 'صورة السيارة: الجانب الأيسر', CAR_PHOTO_RIGHT: 'صورة السيارة: الجانب الأيمن', CAR_PHOTO_INSIDE: 'صورة السيارة: الداخل', CAR_PHOTO_BOOT: 'صورة السيارة: الصندوق',
    } as Record<string, string>,
  },
}

type Filter = 'needs' | 'expiring' | 'duty' | 'low' | 'all'

function fmt(ts: string | null | undefined) {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

export function AdminDriversPage({ lang }: Props) {
  const t = copy[lang === 'ar' ? 'ar' : 'en']
  const isAr = lang === 'ar'
  const [rows, setRows] = useState<DriverReviewRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [filter, setFilter] = useState<Filter>('needs')
  const [selected, setSelected] = useState('')
  const [docs, setDocs] = useState<DriverReviewDoc[]>([])
  const [rejecting, setRejecting] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [keyCode, setKeyCode] = useState('')

  useEffect(() => { void loadQueue() }, [])

  async function loadQueue() {
    setStatus('loading')
    try {
      const r = await fetchDriverReviewQueue()
      setRows(r.drivers)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function pick(userId: string) {
    setSelected(userId)
    setKeyCode('')
    setRejecting('')
    setNote('')
    setMessage('')
    try {
      setDocs(await fetchDriverReviewDocs(userId))
    } catch (error) {
      setDocs([])
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function refreshSelected() {
    await loadQueue()
    if (selected) setDocs(await fetchDriverReviewDocs(selected))
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
      await refreshSelected()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }

  async function openFile(id: string) {
    try {
      const url = await fetchDriverDocBlobUrl(id)
      window.open(url, '_blank', 'noopener')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  const shown = useMemo(() => rows.filter((r) => {
    if (filter === 'needs') return r.inReview > 0 || r.vehicleStatus === 'PENDING_REVIEW'
    if (filter === 'expiring') return r.expiringSoon.length > 0
    if (filter === 'duty') return Boolean(r.onDutyAt)
    if (filter === 'low') return r.lowRating
    return true
  }), [rows, filter])

  const counts = useMemo(() => ({
    needs: rows.filter((r) => r.inReview > 0 || r.vehicleStatus === 'PENDING_REVIEW').length,
    expiring: rows.filter((r) => r.expiringSoon.length > 0).length,
    duty: rows.filter((r) => r.onDutyAt).length,
    low: rows.filter((r) => r.lowRating).length,
  }), [rows])

  const row = rows.find((r) => r.userId === selected)
  const byKind = new Map(docs.map((d) => [d.kind, d]))
  const canIssue = Boolean(row && row.vehicleStatus === 'APPROVED' && row.dutyBlockers.length === 0)

  function chip(d: DriverReviewDoc | undefined) {
    if (!d) return { label: t.missing, style: styles.chipNone }
    if (d.expiresAt && new Date(d.expiresAt).getTime() < Date.now()) return { label: t.expired, style: styles.chipBad }
    if (d.status === 'APPROVED') return { label: t.approved, style: styles.chipOk }
    if (d.status === 'REJECTED') return { label: t.rejected, style: styles.chipBad }
    return { label: t.inReview, style: styles.chipWait }
  }

  const filters: { id: Filter; name: string }[] = [
    { id: 'needs', name: `${t.fNeeds} ${counts.needs}` },
    { id: 'expiring', name: `${t.fExpiring} ${counts.expiring}` },
    { id: 'duty', name: `${t.fDuty} ${counts.duty}` },
    { id: 'low', name: `${t.fLow} ${counts.low}` },
    { id: 'all', name: t.fAll },
  ]

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/admin/review')}>← {t.back}</button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>
      {message && <p style={styles.error}>{message}</p>}

      <div style={styles.layout}>
        <section style={styles.queue}>
          <div style={styles.filters}>
            {filters.map((f) => (
              <button key={f.id} style={filter === f.id ? styles.filterOn : styles.filterOff} onClick={() => setFilter(f.id)}>{f.name}</button>
            ))}
          </div>
          {status === 'loading' && <p style={styles.dim}>{t.loading}</p>}
          {status === 'ready' && shown.length === 0 && <p style={styles.dim}>{t.empty}</p>}
          {shown.map((r) => {
            const name = r.user?.displayName || r.user?.email || r.userId.slice(0, 8)
            const car = [r.vehicleMake, r.vehicleModel, r.vehicleYear].filter(Boolean).join(' ')
            const state = r.onDutyAt ? t.onDuty : `${t.notOnDuty} · ${r.dutyBlockers.length} ${t.toFix}`
            return (
              <button key={r.userId} style={r.userId === selected ? styles.rowOn : styles.row} onClick={() => void pick(r.userId)}>
                <strong>{name}</strong>
                <span style={styles.dim}>{car || '—'}{r.vehiclePlate ? ` · ${r.vehiclePlate}` : ''}</span>
                <span style={r.lowRating ? styles.warn : styles.dim}>
                  {state}{r.inReview ? ` · ${r.inReview} ${t.inReview}` : ''}{r.lowRating ? ` · ${t.lowWarn}` : ''}
                </span>
              </button>
            )
          })}
        </section>

        <section style={styles.detail}>
          {!row && <p style={styles.dim}>{t.pick}</p>}
          {row && (
            <>
              <div style={styles.head}>
                <div>
                  <h2 style={styles.name}>{row.user?.displayName || row.user?.email || row.userId.slice(0, 8)}</h2>
                  <span style={styles.dim}>
                    {t.rating}: {row.rating.averageRating !== null ? `${row.rating.averageRating} (${row.rating.ratingCount})` : t.noTrips}
                  </span>
                </div>
                <span style={row.onDutyAt ? styles.chipOk : styles.chipWait}>
                  {row.onDutyAt ? t.onDuty : `${t.notOnDuty} · ${row.dutyBlockers.length} ${t.toFix}`}
                </span>
              </div>

              <div style={styles.facts}>
                <div style={styles.fact}>
                  <span style={styles.dim}>{t.car}</span>
                  <strong dir="ltr">{[row.vehicleColor, row.vehicleMake, row.vehicleModel, row.vehicleYear].filter(Boolean).join(' ') || '—'}</strong>
                  <span style={styles.dim} dir="ltr">{row.vehiclePlate || '—'} · {row.vehicleCategory || '—'}</span>
                </div>
                <div style={styles.fact}>
                  <span style={styles.dim}>{t.facts}</span>
                  <strong>{row.largeBagCapacity ?? '—'} {t.large} · {row.handBagCapacity ?? '—'} {t.hand}</strong>
                  <span style={styles.dim}>
                    {row.seatCount ?? '—'} {t.seats} · {row.smokingAllowed ? t.smoking : t.nonSmoking} · {row.tyreType === 'WINTER' ? t.winter : row.tyreType === 'ALL_SEASON' ? t.allSeason : t.noTyres}
                  </span>
                </div>
              </div>

              <h3 style={styles.h3}>{t.docs}</h3>
              <div style={styles.docList}>
                {KINDS.map((kind) => {
                  const d = byKind.get(kind)
                  const c = chip(d)
                  return (
                    <div key={kind} style={styles.docRow}>
                      <div style={styles.docMain}>
                        <strong>{t.kinds[kind]}</strong>
                        {d?.expiresAt && <span style={styles.dim}>{t.expires} {fmt(d.expiresAt)}</span>}
                        {d?.adminNote && <span style={styles.warn}>{d.adminNote}</span>}
                      </div>
                      <span style={c.style}>{c.label}</span>
                      {d && (
                        <div style={styles.docActions}>
                          <button style={styles.ghost} onClick={() => void openFile(d.id)}>{t.open}</button>
                          <button style={styles.ok} disabled={busy || d.status === 'APPROVED'} onClick={() => void run(() => reviewDriverDoc(d.id, { status: 'APPROVED' }))}>{t.approve}</button>
                          <button style={styles.bad} disabled={busy} onClick={() => { setRejecting(d.id); setNote('') }}>{t.reject}</button>
                        </div>
                      )}
                      {d && rejecting === d.id && (
                        <div style={styles.rejectBox}>
                          <textarea style={styles.textarea} value={note} placeholder={t.reason} onChange={(e) => setNote(e.target.value)} />
                          <button
                            style={styles.bad}
                            disabled={busy || !note.trim()}
                            onClick={() => void run(async () => { await reviewDriverDoc(d.id, { status: 'REJECTED', note: note.trim() }); setRejecting('') })}
                          >{t.sendReject}</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div style={styles.facts}>
                <div style={styles.fact}>
                  <strong>{t.carStatus}: {row.vehicleStatus || '—'}</strong>
                  <div style={styles.docActions}>
                    <button style={styles.ok} disabled={busy || !row.vehiclePlate || row.vehicleStatus === 'APPROVED'} onClick={() => void run(() => reviewAdminDriverVehicle(row.userId, { decision: 'APPROVE' }))}>{t.approveCar}</button>
                    <button style={styles.bad} disabled={busy} onClick={() => void run(() => reviewAdminDriverVehicle(row.userId, { decision: 'REJECT' }))}>{t.rejectCar}</button>
                  </div>
                </div>
                <div style={styles.fact}>
                  <strong>{t.key}</strong>
                  <span style={styles.dim}>{t.keyHelp}</span>
                  {row.hasKeyCode && <span style={styles.dim}>{t.hasKey}</span>}
                  {!canIssue && row.dutyBlockers.length > 0 && (
                    <span style={styles.warn}>{t.blockedBy}: {row.dutyBlockers.map((b) => t.kinds[b.kind] || b.kind).join(', ')}</span>
                  )}
                  <button style={canIssue ? styles.ok : styles.disabled} disabled={busy || !canIssue} onClick={() => void run(async () => setKeyCode(await issueDriverKeyCode(row.userId)))}>{t.issueKey}</button>
                  {keyCode && (
                    <div style={styles.codeBox}>
                      <span style={styles.dim}>{t.keyShown}</span>
                      <strong dir="ltr" style={styles.code}>{keyCode}</strong>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}

const chipBase: CSSProperties = { borderRadius: 999, fontWeight: 900, fontSize: 12, padding: '4px 10px', whiteSpace: 'nowrap', justifySelf: 'start' }
const btn: CSSProperties = { minHeight: 38, borderRadius: 8, padding: '0 12px', fontWeight: 900, fontFamily: 'inherit', cursor: 'pointer' }

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 14, maxWidth: 1240, margin: '0 auto', alignContent: 'start' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  title: { margin: 0, fontSize: 28 },
  subtitle: { color: '#9aa6ba', margin: 0 },
  layout: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' },
  queue: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 10, display: 'grid', gap: 8 },
  filters: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  filterOn: { ...btn, minHeight: 32, border: 0, background: '#19d7ff', color: '#051014', fontSize: 12 },
  filterOff: { ...btn, minHeight: 32, border: '1px solid #263651', background: '#111827', color: '#fff', fontSize: 12 },
  row: { display: 'grid', gap: 2, textAlign: 'start', border: '1px solid #1e2a3c', borderRadius: 8, background: '#0b111b', color: '#fff', padding: 10, fontFamily: 'inherit', cursor: 'pointer' },
  rowOn: { display: 'grid', gap: 2, textAlign: 'start', border: '1px solid #19d7ff', borderRadius: 8, background: '#0f2230', color: '#fff', padding: 10, fontFamily: 'inherit', cursor: 'pointer' },
  detail: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 12, gridColumn: 'span 2', minWidth: 0 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { margin: 0, fontSize: 22 },
  h3: { margin: '4px 0 0', fontSize: 14, color: '#9aa6ba' },
  facts: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' },
  fact: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#0b111b', padding: 12, display: 'grid', gap: 6, alignContent: 'start' },
  docList: { display: 'grid', gap: 6 },
  docRow: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#0b111b', padding: 10, display: 'grid', gap: 8 },
  docMain: { display: 'grid', gap: 2 },
  docActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  rejectBox: { display: 'grid', gap: 8 },
  textarea: { minHeight: 70, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: 10, fontFamily: 'inherit' },
  dim: { color: '#9aa6ba', fontSize: 13 },
  warn: { color: '#ffd27a', fontSize: 13, fontWeight: 800 },
  error: { color: '#ff8aa0', margin: 0 },
  ok: { ...btn, border: 0, background: '#19d7ff', color: '#051014' },
  bad: { ...btn, border: '1px solid rgba(255,96,96,.5)', background: 'rgba(255,96,96,.12)', color: '#ff8aa0' },
  ghost: { ...btn, border: '1px solid #263651', background: '#111827', color: '#fff' },
  disabled: { ...btn, border: '1px solid #263651', background: '#111827', color: '#6b778c', cursor: 'not-allowed' },
  chipOk: { ...chipBase, background: 'rgba(32,210,155,.15)', border: '1px solid rgba(32,210,155,.5)', color: '#20d29b' },
  chipWait: { ...chipBase, background: 'rgba(255,210,122,.14)', border: '1px solid rgba(255,210,122,.5)', color: '#ffd27a' },
  chipBad: { ...chipBase, background: 'rgba(255,96,96,.12)', border: '1px solid rgba(255,96,96,.5)', color: '#ff8aa0' },
  chipNone: { ...chipBase, background: '#111827', border: '1px solid #263651', color: '#9aa6ba' },
  codeBox: { border: '1px solid #19d7ff', borderRadius: 8, padding: 10, display: 'grid', gap: 4 },
  code: { fontSize: 32, letterSpacing: '.2em' },
}

export default AdminDriversPage
