import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'

export type DateRange = {
  checkIn: string
  checkOut: string
}

type DateRangePickerProps = {
  lang: Lang
  value: DateRange
  onChange: (value: DateRange) => void
  onClose?: () => void
  disabledDates?: Set<string>
  disabledHint?: string
}

type DateFieldProps = {
  lang: Lang
  label: string
  value: string
  active?: boolean
  onClick: () => void
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
    checkIn: 'تاريخ الدخول',
    checkOut: 'تاريخ الخروج',
    choose: 'اختر التاريخ',
    clear: 'مسح',
    done: 'تم',
    nights: 'عدد الليالي',
    unset: 'غير محدد',
    datePlaceholder: 'سنة-شهر-يوم',
    rangeHelp: 'اختر تاريخ الدخول ثم تاريخ الخروج.',
  },
  en: {
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    choose: 'Choose date',
    clear: 'Clear',
    done: 'Done',
    nights: 'Nights',
    unset: 'Not set',
    datePlaceholder: 'yyyy-mm-dd',
    rangeHelp: 'Choose check-in, then check-out.',
  },
  fr: {
    checkIn: 'Arrivée',
    checkOut: 'Départ',
    choose: 'Choisir une date',
    clear: 'Effacer',
    done: 'OK',
    nights: 'Nuits',
    unset: 'Non défini',
    datePlaceholder: 'aaaa-mm-jj',
    rangeHelp: 'Choisissez l’arrivée, puis le départ.',
  },
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function toISO(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function fromISO(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

export function isValidDate(value: string) {
  return Boolean(fromISO(value))
}

// A day is selectable only if it is today or later AND not blocked by availability. Past dates are
// never selectable. ISO YYYY-MM-DD strings compare lexicographically in true chronological order,
// so `iso >= todayIso` is a safe, timezone-stable past-date guard.
export function isSelectableDay(iso: string, todayIso: string, disabledDates?: Set<string>) {
  return iso >= todayIso && !disabledDates?.has(iso)
}

export function nightsBetween(start: string, end: string) {
  const first = fromISO(start)
  const last = fromISO(end)
  if (!first || !last) return 0
  const diff = last.getTime() - first.getTime()
  return Math.max(0, Math.round(diff / 86400000))
}

export function formatDateForLang(value: string, lang: Lang) {
  const date = fromISO(value)
  if (!date) return T[lang].unset
  return `${date.getDate()} ${MONTHS[lang][date.getMonth()]} ${date.getFullYear()}`
}

export function DateField({ lang, label, value, active, onClick }: DateFieldProps) {
  return (
    <button type="button" onClick={onClick} style={{ ...styles.field, border: `1px solid ${active ? '#4f6cff' : '#30384d'}` }}>
      <span style={styles.fieldLabel}>{label}</span>
      <span dir={value ? 'ltr' : lang === 'ar' ? 'rtl' : 'ltr'} style={styles.fieldValue}>
        {value || T[lang].datePlaceholder}
      </span>
      <span style={styles.fieldHint}>{value ? formatDateForLang(value, lang) : T[lang].choose}</span>
    </button>
  )
}

export function DateRangePicker({ lang, value, onChange, onClose, disabledDates, disabledHint }: DateRangePickerProps) {
  // Default to the CURRENT month (a selected check-in still wins). The previous hardcoded July-2026
  // default opened the picker on a past month.
  const todayIso = toISO(new Date())
  const baseDate = fromISO(value.checkIn) ?? new Date()
  const [cursor, setCursor] = useState(() => new Date(baseDate.getFullYear(), baseDate.getMonth(), 1))
  const [selecting, setSelecting] = useState<'checkIn' | 'checkOut'>(value.checkIn && !value.checkOut ? 'checkOut' : 'checkIn')
  const [blockedRangeWarning, setBlockedRangeWarning] = useState(false)
  const t = T[lang]

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const startOffset = first.getDay()
    const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    return Array.from({ length: startOffset + total }, (_, index) => {
      if (index < startOffset) return null
      return new Date(cursor.getFullYear(), cursor.getMonth(), index - startOffset + 1)
    })
  }, [cursor])

  const rangeCrossesDisabledDate = (startIso: string, endIso: string) => {
    if (!disabledDates?.size) return false
    let cursorDate = fromISO(startIso)
    const end = fromISO(endIso)
    if (!cursorDate || !end) return false
    while (cursorDate < end) {
      if (disabledDates.has(toISO(cursorDate))) return true
      cursorDate = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), cursorDate.getDate() + 1)
    }
    return false
  }

  const selectDay = (date: Date) => {
    const iso = toISO(date)
    // Defensive guard: never accept a past or blocked date, regardless of input method.
    if (!isSelectableDay(iso, todayIso, disabledDates)) return
    setBlockedRangeWarning(false)

    if (selecting === 'checkIn' || !value.checkIn) {
      onChange({ checkIn: iso, checkOut: '' })
      setSelecting('checkOut')
      return
    }

    if (iso <= value.checkIn) {
      onChange({ checkIn: iso, checkOut: '' })
      setSelecting('checkOut')
      return
    }

    if (rangeCrossesDisabledDate(value.checkIn, iso)) {
      setBlockedRangeWarning(true)
      return
    }

    onChange({ ...value, checkOut: iso })
  }

  return (
    <section dir={lang === 'ar' ? 'rtl' : 'ltr'} style={styles.picker}>
      <div style={styles.pickerHeader}>
        <button type="button" style={styles.navButton} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
          ‹
        </button>
        <strong style={styles.monthTitle}>{MONTHS[lang][cursor.getMonth()]} {cursor.getFullYear()}</strong>
        <button type="button" style={styles.navButton} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
          ›
        </button>
      </div>

      <p style={styles.help}>{t.rangeHelp}</p>
      {blockedRangeWarning && disabledHint && <p style={styles.warning}>{disabledHint}</p>}

      <div style={styles.weekGrid}>
        {DAYS[lang].map((day, index) => (
          <span key={`${day}-${index}`} style={styles.weekDay}>{day}</span>
        ))}
      </div>

      <div style={styles.dayGrid}>
        {days.map((date, index) => {
          if (!date) return <span key={`empty-${index}`} />
          const iso = toISO(date)
          const isStart = iso === value.checkIn
          const isEnd = iso === value.checkOut
          const inRange = value.checkIn && value.checkOut && iso > value.checkIn && iso < value.checkOut
          const isDisabled = !isSelectableDay(iso, todayIso, disabledDates)
          return (
            <button
              key={iso}
              type="button"
              disabled={isDisabled}
              onClick={() => selectDay(date)}
              style={{
                ...styles.dayButton,
                ...(isStart || isEnd ? styles.daySelected : {}),
                ...(inRange ? styles.dayInRange : {}),
                ...(isDisabled ? styles.dayDisabled : {}),
              }}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>

      <div style={styles.summary}>
        <span>{t.checkIn}: <b>{formatDateForLang(value.checkIn, lang)}</b></span>
        <span>{t.checkOut}: <b>{formatDateForLang(value.checkOut, lang)}</b></span>
        <span>{t.nights}: <b>{nightsBetween(value.checkIn, value.checkOut)}</b></span>
      </div>

      <div style={styles.actions}>
        <button type="button" style={styles.secondaryButton} onClick={() => onChange({ checkIn: '', checkOut: '' })}>{t.clear}</button>
        <button type="button" style={styles.primaryButton} onClick={onClose}>{t.done}</button>
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  field: {
    minHeight: 58,
    border: '1px solid #30384d',
    borderRadius: 14,
    background: '#111827',
    color: '#f8fafc',
    display: 'grid',
    gap: 3,
    padding: '10px 14px',
    textAlign: 'start',
    width: '100%',
  },
  fieldLabel: { color: '#9aa6ba', fontSize: 12, fontWeight: 800 },
  fieldValue: { fontFamily: '"DM Mono", monospace', fontSize: 15, fontWeight: 900 },
  fieldHint: { color: '#6f7b91', fontSize: 11 },
  picker: {
    background: '#111118',
    border: '1px solid #2d3650',
    borderRadius: 20,
    padding: 16,
    boxShadow: '0 24px 60px rgba(0,0,0,.35)',
  },
  pickerHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  navButton: { minWidth: 44, minHeight: 44, borderRadius: 14, border: '1px solid #30384d', background: '#171b29', color: '#fff', fontSize: 24 },
  monthTitle: { color: '#fff', fontSize: 18 },
  help: { margin: '10px 0', color: '#9aa6ba', fontSize: 13 },
  weekGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6 },
  weekDay: { color: '#d5a915', fontSize: 12, fontWeight: 900, textAlign: 'center' },
  dayGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 },
  dayButton: { minHeight: 44, borderRadius: 13, border: '1px solid #242b3d', background: '#171b29', color: '#eef2ff', fontWeight: 900 },
  daySelected: { background: '#4f6cff', borderColor: '#8ea0ff', color: '#fff' },
  dayInRange: { background: 'rgba(79,108,255,.22)', borderColor: 'rgba(79,108,255,.38)' },
  dayDisabled: { background: '#0d0f16', borderColor: '#1c2030', color: '#454b5c', textDecoration: 'line-through' },
  warning: { margin: '10px 0', color: '#ff8a8a', fontSize: 13, fontWeight: 800 },
  summary: { display: 'grid', gap: 8, marginTop: 14, padding: 12, borderRadius: 14, background: '#0c1220', color: '#9aa6ba', fontSize: 12 },
  actions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 14, background: '#4f6cff', color: '#fff', fontWeight: 900 },
  secondaryButton: { minHeight: 48, border: '1px solid #30384d', borderRadius: 14, background: '#171b29', color: '#fff', fontWeight: 900 },
}
