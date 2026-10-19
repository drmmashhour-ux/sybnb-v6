import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import {
  fetchDriverBase, fetchDriverVehicle, fileToBase64, logCarCare, saveVehicleAndFacts, uploadDriverDocument,
  type DocKind, type DriverBase,
} from '../driverBaseApi'

/**
 * Driver application and dashboard checklist (the shared driver base, used by rides now and food later).
 * Order follows Uber/Lyft: your car and what it can carry, then documents with expiry dates, then daily
 * car care. A rejected document shows the admin's note and is re-uploaded in place. Status wording is
 * the same everywhere: Missing, In review, Approved, Fix and re-upload, Expired.
 */
const CATEGORIES = ['BIKE', 'ECONOMY', 'COMFORT', 'SUV', 'VAN'] as const

const DOCS: Array<{ kind: DocKind; ar: string; en: string; fr: string; hintEn: string; hintAr: string; expiry?: boolean; carOnly?: boolean }> = [
  { kind: 'LICENCE', ar: 'رخصة القيادة', en: 'Driving licence', fr: 'Permis de conduire', hintEn: 'Front and back, clear, all four corners visible.', hintAr: 'الوجه والظهر بوضوح وتظهر الزوايا الأربع.', expiry: true },
  { kind: 'REGISTRATION', ar: 'ترخيص السيارة', en: 'Car registration', fr: 'Immatriculation', hintEn: 'Not blurry, all four corners visible.', hintAr: 'غير مشوشة وتظهر الزوايا الأربع.', expiry: true },
  { kind: 'INSURANCE', ar: 'تأمين السيارة', en: 'Car insurance', fr: 'Assurance', hintEn: 'Must be in your name or list you as a driver.', hintAr: 'باسمك أو يذكر أنك سائق مسجل.', expiry: true },
  { kind: 'CRIMINAL_RECORD', ar: 'شهادة عدم محكومية', en: 'Certificate of no criminal record', fr: 'Casier judiciaire', hintEn: 'Issued in the last 90 days. Enter the date it stops being valid.', hintAr: 'صادرة خلال آخر ٩٠ يوماً. أدخل تاريخ انتهاء صلاحيتها.', expiry: true },
  { kind: 'MECHANIC_REPORT', ar: 'تقرير الفحص الميكانيكي', en: 'Mechanic inspection report', fr: 'Rapport d’inspection mécanique', hintEn: 'Signed and stamped by the garage: brakes, tyres, lights, steering.', hintAr: 'موقّع ومختوم من الكراج: الفرامل والإطارات والأضواء والمقود.', expiry: true, carOnly: true },
  { kind: 'EXPERIENCE', ar: 'شهادة الخبرة', en: 'Driving experience (optional)', fr: 'Expérience (facultatif)', hintEn: 'Letter from a past employer or ride company.', hintAr: 'رسالة من جهة عمل أو شركة نقل سابقة.' },
  { kind: 'CAR_PHOTO_FRONT', ar: 'صورة السيارة: أمام', en: 'Car photo: front', fr: 'Photo : avant', hintEn: 'Whole car in daylight.', hintAr: 'السيارة كاملة في ضوء النهار.', carOnly: true },
  { kind: 'CAR_PHOTO_BACK', ar: 'صورة السيارة: خلف', en: 'Car photo: back', fr: 'Photo : arrière', hintEn: 'Plate visible.', hintAr: 'اللوحة ظاهرة.', carOnly: true },
  { kind: 'CAR_PHOTO_LEFT', ar: 'صورة السيارة: يسار', en: 'Car photo: left side', fr: 'Photo : côté gauche', hintEn: 'Whole side of the car.', hintAr: 'الجانب الأيسر كاملاً.', carOnly: true },
  { kind: 'CAR_PHOTO_RIGHT', ar: 'صورة السيارة: يمين', en: 'Car photo: right side', fr: 'Photo : côté droit', hintEn: 'Whole side of the car.', hintAr: 'الجانب الأيمن كاملاً.', carOnly: true },
  { kind: 'CAR_PHOTO_INSIDE', ar: 'صورة السيارة: داخل', en: 'Car photo: inside', fr: 'Photo : intérieur', hintEn: 'Front seats and back seats.', hintAr: 'المقاعد الأمامية والخلفية.', carOnly: true },
  { kind: 'CAR_PHOTO_BOOT', ar: 'صورة السيارة: الصندوق', en: 'Car photo: boot', fr: 'Photo : coffre', hintEn: 'Open boot, empty. Riders use this to check their bags fit.', hintAr: 'الصندوق مفتوحاً وفارغاً ليتأكد الزبون من اتساع حقائبه.', carOnly: true },
]

const card: CSSProperties = { background: '#fff', borderRadius: 14, padding: 14, display: 'grid', gap: 10, boxShadow: '0 1px 0 #e3e6e1' }
const input: CSSProperties = { padding: 11, borderRadius: 10, border: '1px solid #cfd5d0', fontSize: 15, width: '100%', boxSizing: 'border-box' }
const label: CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5b665e' }
const primary: CSSProperties = { padding: 14, borderRadius: 14, border: 0, background: '#0a7d3b', color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' }

export function DriverApplication({ lang }: { lang: Lang }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [base, setBase] = useState<DriverBase | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // car form
  const [make, setMake] = useState(''); const [model, setModel] = useState(''); const [plate, setPlate] = useState('')
  const [category, setCategory] = useState<string>('COMFORT'); const [year, setYear] = useState(''); const [color, setColor] = useState('')
  const [regExp, setRegExp] = useState('')
  const [large, setLarge] = useState('3'); const [hand, setHand] = useState('3'); const [seats, setSeats] = useState('4')
  const [smoking, setSmoking] = useState(false); const [tyre, setTyre] = useState<'WINTER' | 'ALL_SEASON'>('ALL_SEASON'); const [tyreDate, setTyreDate] = useState('')
  // document expiry inputs, per kind
  const [expiry, setExpiry] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const b = await fetchDriverBase()
      setBase(b)
      const v = (await fetchDriverVehicle()).driverProfile as Record<string, any> | null
      if (v) {
        setMake(v.vehicleMake || ''); setModel(v.vehicleModel || ''); setPlate(v.vehiclePlate || '')
        if (v.vehicleCategory) setCategory(v.vehicleCategory)
        setYear(v.vehicleYear ? String(v.vehicleYear) : ''); setColor(v.vehicleColor || '')
        setRegExp(v.registrationExpiresAt ? String(v.registrationExpiresAt).slice(0, 10) : '')
        if (v.largeBagCapacity != null) setLarge(String(v.largeBagCapacity))
        if (v.handBagCapacity != null) setHand(String(v.handBagCapacity))
        if (v.seatCount != null) setSeats(String(v.seatCount))
        setSmoking(Boolean(v.smokingAllowed))
        if (v.tyreType) setTyre(v.tyreType)
        setTyreDate(v.tyresFittedOn ? String(v.tyresFittedOn).slice(0, 10) : '')
      }
    } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])

  const isCar = category !== 'BIKE'
  const docs = DOCS.filter((d) => isCar || !d.carOnly)
  const statusOf = (k: DocKind) => base?.documents.find((d) => d.kind === k)
  const blocker = (k: DocKind) => base?.dutyBlockers.find((b) => b.kind === k)

  const chip = (k: DocKind) => {
    const b = blocker(k); const d = statusOf(k)
    if (b?.reason === 'EXPIRED') return { text: t('منتهية', 'Expired', 'Expiré'), bg: '#fbd9d9', fg: '#8a1c1c' }
    if (!d) return { text: t('ناقصة', 'Missing', 'Manquant'), bg: '#101611', fg: '#fff' }
    if (d.status === 'APPROVED') return { text: t('مقبولة', 'Approved', 'Approuvé'), bg: '#dff3e6', fg: '#0a5a2a' }
    if (d.status === 'REJECTED') return { text: t('أعد الرفع', 'Fix and re-upload', 'À corriger'), bg: '#fbd9d9', fg: '#8a1c1c' }
    return { text: t('قيد المراجعة', 'In review', 'En vérification'), bg: '#fdeccc', fg: '#7a4a00' }
  }

  async function saveCar() {
    setError(''); setNotice(''); setBusy(true)
    try {
      await saveVehicleAndFacts({
        vehicleMake: make, vehicleModel: model, vehiclePlate: plate, vehicleCategory: category,
        vehicleYear: year ? Number(year) : undefined, vehicleColor: color || undefined,
        registrationExpiresAt: regExp || undefined,
        largeBagCapacity: Number(large), handBagCapacity: Number(hand), seatCount: Number(seats),
        smokingAllowed: smoking, tyreType: tyre, tyresFittedOn: tyreDate || undefined,
      })
      setNotice(t('تم حفظ معلومات السيارة وهي قيد المراجعة.', 'Car saved. It is now in review.', 'Voiture enregistrée. Elle est en vérification.'))
      await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function upload(kind: DocKind, file: File | undefined, needsExpiry: boolean) {
    if (!file) return
    setError(''); setNotice('')
    if (needsExpiry && !expiry[kind]) { setError(t('أدخل تاريخ انتهاء الوثيقة أولاً.', 'Enter the expiry date first.', 'Saisissez d’abord la date d’expiration.')); return }
    setBusy(true)
    try {
      await uploadDriverDocument(kind, await fileToBase64(file), file.type, expiry[kind])
      setNotice(t('تم رفع الوثيقة وهي قيد المراجعة.', 'Uploaded. It is now in review.', 'Téléversé. En vérification.'))
      await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function care(kind: 'OUTSIDE' | 'INSIDE') {
    setBusy(true)
    try { await logCarCare(kind); await load() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const requiredKinds = docs.filter((d) => d.kind !== 'EXPERIENCE').map((d) => d.kind)
  const approved = requiredKinds.filter((k) => statusOf(k)?.status === 'APPROVED' && blocker(k)?.reason !== 'EXPIRED').length
  const pct = Math.round((approved / Math.max(1, requiredKinds.length)) * 100)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const fmtDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '-')
  const docName = (k: DocKind) => { const d = DOCS.find((x) => x.kind === k); return d ? (lang === 'ar' ? d.ar : lang === 'fr' ? d.fr : d.en) : k }

  return (
    <div dir={dir} style={{ maxWidth: 480, margin: '0 auto', padding: 16, display: 'grid', gap: 14, background: '#f3f4f0', minHeight: '100vh', fontFamily: "'DM Sans', system-ui, sans-serif", color: '#101611' }}>
      <div style={{ background: '#101611', color: '#fff', borderRadius: 16, padding: 18, display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#9bd6ae' }}>{t('طلب الانضمام كسائق', 'DRIVER APPLICATION', 'CANDIDATURE CHAUFFEUR')}</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>
          {base?.vehicleStatus === 'APPROVED' && base.dutyBlockers.length === 0
            ? t('أنت جاهز للعمل', 'You are ready to drive', 'Vous êtes prêt à conduire')
            : t('أكمل طلبك', 'Finish your application', 'Terminez votre candidature')}
        </div>
        <div style={{ height: 8, borderRadius: 4, background: '#2a352d' }}><div style={{ width: `${pct}%`, height: 8, borderRadius: 4, background: '#3ddc84' }} /></div>
        <div style={{ fontSize: 13, color: '#c9d3cc' }}>{approved} / {requiredKinds.length} {t('وثائق مقبولة', 'documents approved', 'documents approuvés')}</div>
      </div>

      {error && <div role="alert" style={{ background: '#fbd9d9', color: '#8a1c1c', padding: 12, borderRadius: 12, fontSize: 14 }}>{error}</div>}
      {notice && <div style={{ background: '#dff3e6', color: '#0a5a2a', padding: 12, borderRadius: 12, fontSize: 14 }}>{notice}</div>}

      {(base?.expiringSoon.length ?? 0) > 0 && (
        <div style={{ background: '#fdeccc', color: '#3d2a00', padding: 12, borderRadius: 12, fontSize: 14 }}>
          {base!.expiringSoon.map((e) => `${docName(e.kind)}: ${e.days} ${t('يوم متبقٍ', 'days left', 'jours restants')}`).join(' · ')}
        </div>
      )}

      <section style={card}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>1. {t('سيارتك وما تتسع له', 'Your car and what it carries', 'Votre voiture et ses bagages')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><div style={label}>{t('الماركة', 'MAKE', 'MARQUE')}</div><input style={input} value={make} onChange={(e) => setMake(e.target.value)} /></div>
          <div><div style={label}>{t('الطراز', 'MODEL', 'MODÈLE')}</div><input style={input} value={model} onChange={(e) => setModel(e.target.value)} /></div>
          <div><div style={label}>{t('اللوحة', 'PLATE', 'PLAQUE')}</div><input style={input} value={plate} onChange={(e) => setPlate(e.target.value)} /></div>
          <div><div style={label}>{t('السنة', 'YEAR', 'ANNÉE')}</div><input style={input} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} /></div>
          <div><div style={label}>{t('اللون', 'COLOUR', 'COULEUR')}</div><input style={input} value={color} onChange={(e) => setColor(e.target.value)} /></div>
          <div><div style={label}>{t('انتهاء الترخيص', 'REGISTRATION EXPIRES', 'EXPIRATION IMMAT.')}</div><input style={input} type="date" value={regExp} onChange={(e) => setRegExp(e.target.value)} /></div>
        </div>
        <div><div style={label}>{t('الفئة', 'CATEGORY', 'CATÉGORIE')}</div>
          <select style={input} value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <div><div style={label}>{t('حقائب كبيرة ٢٣ كغ', 'LARGE BAGS 23 KG', 'GRANDES VALISES 23 KG')}</div><input style={input} inputMode="numeric" value={large} onChange={(e) => setLarge(e.target.value)} /></div>
          <div><div style={label}>{t('حقائب يد', 'HAND BAGS', 'BAGAGES À MAIN')}</div><input style={input} inputMode="numeric" value={hand} onChange={(e) => setHand(e.target.value)} /></div>
          <div><div style={label}>{t('المقاعد', 'SEATS', 'PLACES')}</div><input style={input} inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} /></div>
        </div>
        <div style={{ background: '#dff3e6', color: '#0a5a2a', borderRadius: 10, padding: 10, fontSize: 13 }}>
          {t('سيرى الزبون:', 'Riders will see:', 'Les clients verront :')} {t(`تتسع لـ ${large} حقائب كبيرة و${hand} حقائب يد`, `Fits ${large} large bags + ${hand} hand bags`, `${large} grandes valises + ${hand} bagages à main`)}
        </div>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 15 }}>
          <input type="checkbox" checked={smoking} onChange={(e) => setSmoking(e.target.checked)} />
          {smoking ? t('التدخين مسموح', 'Smoking allowed', 'Fumeur') : t('ممنوع التدخين', 'Non-smoking car', 'Voiture non-fumeur')}
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><div style={label}>{t('الإطارات', 'TYRES', 'PNEUS')}</div>
            <select style={input} value={tyre} onChange={(e) => setTyre(e.target.value as 'WINTER' | 'ALL_SEASON')}>
              <option value="ALL_SEASON">{t('كل المواسم', 'All-season', 'Quatre saisons')}</option>
              <option value="WINTER">{t('شتوية', 'Winter', 'Hiver')}</option>
            </select></div>
          <div><div style={label}>{t('تاريخ التركيب', 'FITTED ON', 'POSÉS LE')}</div><input style={input} type="date" value={tyreDate} onChange={(e) => setTyreDate(e.target.value)} /></div>
        </div>
        <button type="button" style={{ ...primary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={saveCar}>{t('حفظ السيارة', 'Save car', 'Enregistrer')}</button>
      </section>

      <section style={card}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>2. {t('الوثائق والصور', 'Documents and photos', 'Documents et photos')}</div>
        {docs.map((d) => {
          const c = chip(d.kind); const s = statusOf(d.kind)
          return (
            <div key={d.kind} style={{ borderTop: '1px solid #eceeea', paddingTop: 10, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{docName(d.kind)}</div>
                <span style={{ fontSize: 12, fontWeight: 800, padding: '5px 10px', borderRadius: 12, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>{c.text}</span>
              </div>
              <div style={{ fontSize: 12, color: '#5b665e' }}>{lang === 'ar' ? d.hintAr : d.hintEn}</div>
              {s?.status === 'REJECTED' && s.adminNote && (
                <div style={{ background: '#fdeccc', color: '#3d2a00', borderRadius: 10, padding: 8, fontSize: 13 }}><b>{t('فريق Rezekme:', 'Rezekme team:', 'Équipe Rezekme :')}</b> {s.adminNote}</div>
              )}
              {s?.expiresAt && <div style={{ fontSize: 12, color: '#5b665e' }}>{t('تنتهي', 'Expires', 'Expire')}: {fmtDay(s.expiresAt)}</div>}
              {d.expiry && (
                <div><div style={label}>{t('تاريخ الانتهاء', 'EXPIRY DATE', 'DATE D’EXPIRATION')}</div>
                  <input style={input} type="date" value={expiry[d.kind] || ''} onChange={(e) => setExpiry({ ...expiry, [d.kind]: e.target.value })} /></div>
              )}
              <input type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy} onChange={(e) => { void upload(d.kind, e.target.files?.[0], Boolean(d.expiry)); e.target.value = '' }} />
            </div>
          )
        })}
      </section>

      <section style={card}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>3. {t('نظافة السيارة', 'Car care', 'Entretien')}</div>
        {(['OUTSIDE', 'INSIDE'] as const).map((k) => {
          const st = base?.carCare[k]
          return (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{k === 'OUTSIDE' ? t('غسيل الخارج (يومياً)', 'Outside washed (daily)', 'Extérieur lavé (chaque jour)') : t('تنظيف الداخل (أسبوعياً)', 'Inside cleaned (weekly)', 'Intérieur nettoyé (chaque semaine)')}</div>
                <div style={{ fontSize: 12, color: st?.due ? '#b26a00' : '#5b665e' }}>{st?.lastDoneAt ? `${t('آخر مرة', 'Last', 'Dernier')}: ${new Date(st.lastDoneAt).toLocaleString()}` : t('لم يُسجَّل بعد', 'Not logged yet', 'Pas encore')}{st?.due ? ` · ${t('مستحق', 'Due', 'À faire')}` : ''}</div>
              </div>
              <button type="button" style={{ ...primary, padding: '10px 14px', fontSize: 14 }} disabled={busy} onClick={() => care(k)}>{t('تم', 'Done', 'Fait')}</button>
            </div>
          )
        })}
      </section>
    </div>
  )
}
