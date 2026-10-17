// Keeps deals on-platform: hides contact details written into chat messages (message moderation,
// 2026-10-11, hardened 2026-10-17). Conservative on purpose: bare long numbers (a SYP price such as
// 35000000) are left alone so negotiation is not mangled.
//
// Covered: emails (also "name at gmail dot com"), links, WhatsApp/Telegram links, international and
// Syrian mobile numbers, separator-grouped numbers, Arabic-Indic / Persian digits, numbers spelled
// out in words (English, French, Arabic) or digit-by-digit with separators, off-platform app names
// and @handles.
export const CONTACT_HIDDEN = '[contact hidden]'

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹'

// 1:1 character mapping, so match indices on the normalised copy are valid on the original text.
function normalizeDigits(text) {
  let out = ''
  for (const ch of text) {
    const a = ARABIC_INDIC.indexOf(ch)
    const p = PERSIAN.indexOf(ch)
    out += a >= 0 ? String(a) : p >= 0 ? String(p) : ch
  }
  return out
}

const DIGIT_WORDS = [
  'zero', 'oh', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'z[ée]ro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'sept', 'huit', 'neuf',
  'صفر', 'واحد', 'اثنين', 'اثنان', 'ثنين', 'ثلاثة', 'ثلاث', 'أربعة', 'اربعة', 'اربع', 'خمسة', 'خمس', 'ستة', 'ست', 'سبعة', 'سبع', 'ثمانية', 'ثمان', 'تسعة', 'تسع',
].join('|')
// A run of 7+ single digits or digit words separated by spaces/dots/dashes ("zero nine four ...", "0 9 4 ...").
const SPELLED_NUMBER = new RegExp(`(?<![\\p{L}\\d])(?:(?:\\d|${DIGIT_WORDS})(?![\\p{L}\\d])[\\s.\\-_]+){6,}(?:\\d|${DIGIT_WORDS})(?![\\p{L}\\d])`, 'giu')

const RULES = [
  /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi, // emails
  /\b[\w.+-]+\s*(?:\(at\)|\[at\]|\bat\b|\barobase\b)\s*[\w-]+\s*(?:\(dot\)|\[dot\]|\bdot\b|\bpoint\b)\s*(?:com|net|org|co|sy|ca|fr|app)\b/gi, // "name at gmail dot com"
  /\b(?:https?:\/\/|www\.)[^\s]+/gi, // urls
  /(?:wa\.me|t\.me|telegram\.me)\/[^\s]*/gi, // messaging links
  /(?:\+|00)\d[\d\s().-]{6,}\d/g, // international phone
  /\b0?9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g, // Syrian mobile 09xxxxxxxx
  /\b\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g, // separator-grouped phone
  SPELLED_NUMBER,
  /(?:whats\s*app|watsapp|واتس\s*اب|واتساب|واتس|telegram|تلغرام|تيليغرام|تيليجرام|viber|فايبر|signal\s+app)/giu, // off-platform apps
  /(?<![\w@])@[a-z0-9_.]{3,}/gi, // @handles
]

export function redactContactInfo(text) {
  if (!text || typeof text !== 'string') return text
  const normalized = normalizeDigits(text)
  const ranges = []
  for (const rule of RULES) {
    rule.lastIndex = 0
    for (const match of normalized.matchAll(rule)) {
      if (match[0].length === 0) continue
      ranges.push([match.index, match.index + match[0].length])
    }
  }
  if (ranges.length === 0) return text
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const merged = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([...range])
  }
  let out = ''
  let cursor = 0
  for (const [start, end] of merged) {
    out += text.slice(cursor, start) + CONTACT_HIDDEN
    cursor = end
  }
  return out + text.slice(cursor)
}
