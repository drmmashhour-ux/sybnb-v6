// Restaurant opening hours (2026-10-17). Stored on the merchant as JSON:
//   { tz: 'Asia/Damascus', days: [0..6], open: 'HH:MM', close: 'HH:MM' }
// `days` are the open weekdays (0 = Sunday). The same window applies to each open day. If close is
// earlier than open the window runs past midnight (e.g. 18:00 -> 02:00): the part after midnight
// belongs to the PREVIOUS day's opening. No hours (null) means "always open" (the busy switch still
// applies).
export const DEFAULT_TZ = 'Asia/Damascus'
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

function minutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function validateOpeningHours(raw) {
  if (raw === null || raw === undefined) return null
  const bad = (message) => Object.assign(new Error(message), { statusCode: 400, code: 'MERCHANT_HOURS_INVALID', expose: true })
  if (typeof raw !== 'object' || Array.isArray(raw)) throw bad('Opening hours are not valid.')
  const days = Array.isArray(raw.days) ? [...new Set(raw.days.map(Number))] : []
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw bad('Choose at least one opening day.')
  if (!HHMM.test(String(raw.open)) || !HHMM.test(String(raw.close))) throw bad('Opening and closing times must look like 09:00.')
  if (raw.open === raw.close) throw bad('Opening and closing time cannot be the same.')
  const tz = raw.tz ? String(raw.tz) : DEFAULT_TZ
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    throw bad('Time zone is not valid.')
  }
  return { tz, days: days.sort(), open: String(raw.open), close: String(raw.close) }
}

function localParts(now, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (type) => parts.find((p) => p.type === type)?.value
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

export function isOpenNow(hours, now = new Date()) {
  if (!hours) return true
  const { weekday, minutes: nowMin } = localParts(now, hours.tz || DEFAULT_TZ)
  const open = minutes(hours.open)
  const close = minutes(hours.close)
  if (open < close) return hours.days.includes(weekday) && nowMin >= open && nowMin < close
  // Overnight window: evening part on an open day, early-morning part belongs to the day before.
  if (nowMin >= open) return hours.days.includes(weekday)
  if (nowMin < close) return hours.days.includes((weekday + 6) % 7)
  return false
}
