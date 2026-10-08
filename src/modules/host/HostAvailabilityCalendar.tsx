import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchListingAvailability, updateHostListingAvailability, type HostDashboardMode } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
  listingId: string
  basePriceMinor: number
  currency: string
  mode?: HostDashboardMode
}

const MONTHS = {
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
}

const DAYS = {
  ar: ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'],
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  fr: ['D', 'L', 'M', 'M', 'J', 'V', 'S'],
}

const T = {
  ar: {
    title: 'تقويم الحجوزات المتوفرة',
    help: 'اضغط على أي تاريخ متاح لحجبه، واضغط عليه مجددا لإعادة إتاحته. لمسة واحدة كافية.',
    legendAvailable: 'متاح',
    legendBlocked: 'محجوب من المضيف',
    legendBooked: 'محجوز من ضيف',
    saving: 'جار الحفظ...',
    loadError: 'تعذر تحميل تقويم الحجوزات المتوفرة.',
    saveError: 'تعذر حفظ التغيير. حاول مجددا.',
    todayBadge: 'اليوم',
    pricingTitle: 'أسعار متغيرة (نهاية الأسبوع والمواسم)',
    weekendLabel: 'سعر نهاية الأسبوع (الجمعة والسبت)',
    weekendApply: 'تطبيق على عطلات هذا الشهر والشهر القادم',
    seasonLabel: 'سعر موسمي لفترة محددة',
    seasonFrom: 'من',
    seasonTo: 'إلى',
    seasonPrice: 'السعر لليلة',
    seasonApply: 'تطبيق كسعر موسمي',
    clearRange: 'إعادة كل الفترة للسعر الأساسي',
    basePrice: 'السعر الأساسي لليلة',
    pricingSaved: 'تم حفظ التسعير.',
    pricingError: 'تعذر حفظ التسعير. تحقق من الأرقام والتواريخ.',
  },
  en: {
    title: 'Availability calendar',
    help: 'Tap any available date to block it, tap again to make it available. One tap is all it takes.',
    legendAvailable: 'Available',
    legendBlocked: 'Blocked by host',
    legendBooked: 'Booked by a guest',
    saving: 'Saving...',
    loadError: 'Could not load the availability calendar.',
    saveError: 'Could not save that change. Try again.',
    todayBadge: 'Today',
    pricingTitle: 'Variable pricing (weekend & high season)',
    weekendLabel: 'Weekend price (Fri & Sat)',
    weekendApply: 'Apply to weekends this month & next',
    seasonLabel: 'High-season price for a date range',
    seasonFrom: 'From',
    seasonTo: 'To',
    seasonPrice: 'Price per night',
    seasonApply: 'Apply as high-season price',
    clearRange: 'Reset that range to the base price',
    basePrice: 'Base price per night',
    pricingSaved: 'Pricing saved.',
    pricingError: 'Could not save pricing. Check the numbers and dates.',
  },
  fr: {
    title: 'Calendrier des disponibilités',
    help: 'Touchez une date disponible pour la bloquer, touchez-la de nouveau pour la rendre disponible. Une seule touche suffit.',
    legendAvailable: 'Disponible',
    legendBlocked: 'Bloqué par l’hôte',
    legendBooked: 'Réservé par un voyageur',
    saving: 'Enregistrement...',
    loadError: 'Impossible de charger le calendrier des disponibilités.',
    saveError: 'Impossible d’enregistrer ce changement. Veuillez réessayer.',
    todayBadge: 'Aujourd’hui',
    pricingTitle: 'Tarifs variables (fin de semaine et haute saison)',
    weekendLabel: 'Prix de fin de semaine (ven. et sam.)',
    weekendApply: 'Appliquer aux fins de semaine de ce mois et du suivant',
    seasonLabel: 'Prix haute saison pour une période',
    seasonFrom: 'Du',
    seasonTo: 'Au',
    seasonPrice: 'Prix par nuit',
    seasonApply: 'Appliquer comme prix haute saison',
    clearRange: 'Rétablir le prix de base pour cette période',
    basePrice: 'Prix de base par nuit',
    pricingSaved: 'Tarifs enregistrés.',
    pricingError: 'Impossible d’enregistrer les tarifs. Vérifiez les montants et les dates.',
  },
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function toISO(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function monthRange(cursor: Date) {
  const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const to = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0)
  return { from: toISO(from), to: toISO(to) }
}

export function HostAvailabilityCalendar({ lang, listingId, basePriceMinor, currency, mode = 'host' }: Props) {
  const isAr = lang === 'ar'
  const t = T[lang]
  const [cursor, setCursor] = useState(() => new Date())
  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set())
  const [bookedDates, setBookedDates] = useState<Set<string>>(new Set())
  const [priceOverrides, setPriceOverrides] = useState<Map<string, number>>(new Map())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [savingDate, setSavingDate] = useState('')
  const [message, setMessage] = useState('')
  const [weekendPriceInput, setWeekendPriceInput] = useState('')
  const [seasonFrom, setSeasonFrom] = useState('')
  const [seasonTo, setSeasonTo] = useState('')
  const [seasonPriceInput, setSeasonPriceInput] = useState('')
  const [pricingBusy, setPricingBusy] = useState(false)
  const [pricingMessage, setPricingMessage] = useState('')

  useEffect(() => {
    void loadAvailability()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId, cursor.getFullYear(), cursor.getMonth()])

  async function loadAvailability() {
    setStatus('loading')
    setMessage('')
    try {
      const { from, to } = monthRange(cursor)
      const response = await fetchListingAvailability(listingId, from, to)
      setBlockedDates(new Set(response.blockedDates))
      setPriceOverrides(new Map(response.priceOverrides.map((row) => [row.date, row.priceMinor])))
      const booked = new Set<string>()
      response.bookedRanges.forEach((range) => {
        let day = new Date(`${range.checkIn}T00:00:00`)
        const end = new Date(`${range.checkOut}T00:00:00`)
        while (day < end) {
          booked.add(toISO(day))
          day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
        }
      })
      setBookedDates(booked)
      setStatus('ready')
    } catch {
      setStatus('error')
      setMessage(t.loadError)
    }
  }

  async function applyWeekendPricing() {
    const priceMinor = Math.round(Number(weekendPriceInput))
    if (!Number.isFinite(priceMinor) || priceMinor <= 0) {
      setPricingMessage(t.pricingError)
      return
    }
    const dates: string[] = []
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0)
    for (let day = new Date(start); day <= end; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
      const weekday = day.getDay()
      if (weekday === 5 || weekday === 6) dates.push(toISO(day)) // Friday & Saturday
    }
    await applyPriceToDates(dates, priceMinor)
  }

  async function applySeasonPricing() {
    const priceMinor = Math.round(Number(seasonPriceInput))
    const start = seasonFrom ? new Date(`${seasonFrom}T00:00:00`) : null
    const end = seasonTo ? new Date(`${seasonTo}T00:00:00`) : null
    if (!start || !end || end < start || !Number.isFinite(priceMinor) || priceMinor <= 0) {
      setPricingMessage(t.pricingError)
      return
    }
    const dates: string[] = []
    for (let day = new Date(start); day <= end; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
      dates.push(toISO(day))
    }
    await applyPriceToDates(dates, priceMinor)
  }

  async function applyPriceToDates(dates: string[], priceMinor: number) {
    if (!dates.length) return
    setPricingBusy(true)
    setPricingMessage('')
    try {
      await updateHostListingAvailability(
        listingId,
        dates.map((date) => ({ date, status: blockedDates.has(date) ? 'BLOCKED' : 'AVAILABLE', priceOverrideMinor: priceMinor })),
        mode,
      )
      setPriceOverrides((current) => {
        const next = new Map(current)
        dates.forEach((date) => next.set(date, priceMinor))
        return next
      })
      setPricingMessage(t.pricingSaved)
    } catch {
      setPricingMessage(t.pricingError)
    } finally {
      setPricingBusy(false)
    }
  }

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const startOffset = first.getDay()
    const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    return Array.from({ length: startOffset + total }, (_, index) => {
      if (index < startOffset) return null
      return new Date(cursor.getFullYear(), cursor.getMonth(), index - startOffset + 1)
    })
  }, [cursor])

  async function toggleDate(date: Date) {
    const iso = toISO(date)
    if (bookedDates.has(iso) || savingDate) return

    const nextStatus: 'BLOCKED' | 'AVAILABLE' = blockedDates.has(iso) ? 'AVAILABLE' : 'BLOCKED'
    const previouslyBlocked = new Set(blockedDates)
    setBlockedDates((current) => {
      const next = new Set(current)
      if (nextStatus === 'BLOCKED') next.add(iso)
      else next.delete(iso)
      return next
    })
    setSavingDate(iso)
    setMessage('')

    try {
      await updateHostListingAvailability(listingId, [{ date: iso, status: nextStatus }], mode)
    } catch {
      setBlockedDates(previouslyBlocked)
      setMessage(t.saveError)
    } finally {
      setSavingDate('')
    }
  }

  const todayIso = toISO(new Date())

  return (
    <section dir={isAr ? 'rtl' : 'ltr'} style={styles.wrap}>
      <div style={styles.head}>
        <strong>{t.title}</strong>
        <span style={styles.legendDot}>
          <b style={{ ...styles.dot, background: '#20d29b' }} /> {t.legendAvailable}
          <b style={{ ...styles.dot, background: '#e5b80b' }} /> {t.legendBlocked}
          <b style={{ ...styles.dot, background: '#ff4e77' }} /> {t.legendBooked}
        </span>
      </div>
      <p style={styles.help}>{t.help}</p>

      {status === 'error' && <p style={styles.error}>{message}</p>}
      {message && status !== 'error' && <p style={styles.error}>{message}</p>}

      <div style={styles.pickerHeader}>
        <button
          type="button"
          style={styles.navButton}
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
        >
          ‹
        </button>
        <strong style={styles.monthTitle}>{MONTHS[lang][cursor.getMonth()]} {cursor.getFullYear()}</strong>
        <button
          type="button"
          style={styles.navButton}
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
        >
          ›
        </button>
      </div>

      <div style={styles.weekGrid}>
        {DAYS[lang].map((day, index) => (
          <span key={`${day}-${index}`} style={styles.weekDay}>{day}</span>
        ))}
      </div>

      <div style={styles.dayGrid}>
        {days.map((date, index) => {
          if (!date) return <span key={`empty-${index}`} />
          const iso = toISO(date)
          const isBooked = bookedDates.has(iso)
          const isBlocked = blockedDates.has(iso)
          const isSaving = savingDate === iso
          const isToday = iso === todayIso
          return (
            <button
              key={iso}
              type="button"
              disabled={isBooked || status === 'loading'}
              onClick={() => void toggleDate(date)}
              aria-label={isBooked ? t.legendBooked : isBlocked ? t.legendBlocked : t.legendAvailable}
              style={{
                ...styles.dayButton,
                ...(isBlocked ? styles.dayBlocked : {}),
                ...(isBooked ? styles.dayBooked : {}),
                ...(isToday ? styles.dayToday : {}),
                ...(isSaving ? styles.daySaving : {}),
              }}
            >
              <span>{date.getDate()}</span>
              {priceOverrides.has(iso) && (
                <small style={styles.dayPrice}>{moneyText(priceOverrides.get(iso) as number, currency, lang)}</small>
              )}
            </button>
          )
        })}
      </div>

      <div style={styles.pricingPanel}>
        <strong>{t.pricingTitle}</strong>
        <span style={styles.basePriceLine}>{t.basePrice}: {moneyText(basePriceMinor, currency, lang)}</span>

        <div style={styles.pricingRow}>
          <label style={styles.pricingLabel}>
            {t.weekendLabel}
            <input
              inputMode="decimal"
              placeholder={String(basePriceMinor)}
              style={styles.pricingInput}
              type="number"
              value={weekendPriceInput}
              onChange={(event) => setWeekendPriceInput(event.target.value)}
            />
          </label>
          <button disabled={pricingBusy} style={styles.applyButton} onClick={() => void applyWeekendPricing()}>
            {t.weekendApply}
          </button>
        </div>

        <div style={styles.pricingRow}>
          <label style={styles.pricingLabel}>
            {t.seasonFrom}
            <input style={styles.pricingInput} type="date" value={seasonFrom} onChange={(event) => setSeasonFrom(event.target.value)} />
          </label>
          <label style={styles.pricingLabel}>
            {t.seasonTo}
            <input style={styles.pricingInput} type="date" value={seasonTo} onChange={(event) => setSeasonTo(event.target.value)} />
          </label>
          <label style={styles.pricingLabel}>
            {t.seasonPrice}
            <input
              inputMode="decimal"
              placeholder={String(basePriceMinor)}
              style={styles.pricingInput}
              type="number"
              value={seasonPriceInput}
              onChange={(event) => setSeasonPriceInput(event.target.value)}
            />
          </label>
          <button disabled={pricingBusy} style={styles.applyButton} onClick={() => void applySeasonPricing()}>
            {t.seasonApply}
          </button>
        </div>

        {pricingMessage && <p style={styles.error}>{pricingMessage}</p>}
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { border: '1px solid #242735', borderRadius: 8, background: '#111118', padding: 16, display: 'grid', gap: 10 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, color: '#fff' },
  legendDot: { display: 'flex', alignItems: 'center', gap: 6, color: '#9aa6ba', fontSize: 12, fontWeight: 800 },
  dot: { width: 10, height: 10, borderRadius: 999, display: 'inline-block', marginInlineStart: 8, marginInlineEnd: 4 },
  help: { margin: 0, color: '#9aa6ba', fontSize: 13 },
  error: { margin: 0, color: '#ffd1d1', fontSize: 13, fontWeight: 800 },
  pickerHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  navButton: { minWidth: 44, minHeight: 44, borderRadius: 14, border: '1px solid #30384d', background: '#171b29', color: '#fff', fontSize: 24 },
  monthTitle: { color: '#fff', fontSize: 18 },
  weekGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6 },
  weekDay: { color: '#d5a915', fontSize: 12, fontWeight: 900, textAlign: 'center' },
  dayGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 },
  dayButton: { minHeight: 52, borderRadius: 13, border: '1px solid #242b3d', background: '#0c1220', color: '#20d29b', fontWeight: 900, fontSize: 15, display: 'grid', gap: 2, placeItems: 'center', padding: '4px 2px' },
  dayBlocked: { background: 'rgba(229,184,11,.14)', borderColor: 'rgba(229,184,11,.5)', color: '#e5b80b' },
  dayBooked: { background: 'rgba(255,78,119,.14)', borderColor: 'rgba(255,78,119,.5)', color: '#ff4e77' },
  dayToday: { boxShadow: '0 0 0 2px rgba(82,108,255,.65) inset' },
  daySaving: { opacity: 0.55 },
  dayPrice: { fontSize: 9, fontWeight: 800, color: '#8ea0ff', lineHeight: 1 },
  pricingPanel: { border: '1px solid rgba(213,169,21,.4)', borderRadius: 8, background: 'rgba(213,169,21,.06)', padding: 14, display: 'grid', gap: 12, marginTop: 6 },
  basePriceLine: { color: '#9aa6ba', fontSize: 13, fontWeight: 800 },
  pricingRow: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' },
  pricingLabel: { display: 'grid', gap: 4, color: '#d5a915', fontSize: 12, fontWeight: 800, minWidth: 120 },
  pricingInput: { minHeight: 44, borderRadius: 10, border: '1px solid #30384d', background: '#0d1320', color: '#fff', padding: '0 10px', fontWeight: 800 },
  applyButton: { minHeight: 44, border: 0, borderRadius: 10, background: '#e5b80b', color: '#181207', fontWeight: 950, padding: '0 14px', whiteSpace: 'nowrap' },
}
