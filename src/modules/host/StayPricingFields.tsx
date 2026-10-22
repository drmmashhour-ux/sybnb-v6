import { pick, type Lang } from '../../engines/language/languageEngine'

// Host pricing rules for a stay (2026-10-22): weekend price, weekly/monthly discount, and whether the
// platform's high-season pricing (set by admin: Eid, summer...) applies. Used in the listing wizard
// and in the host dashboard's pricing editor. The server clamps every value (stay-pricing.mjs).
export type StayPricingDraft = {
  weekendPrice: string
  weeklyDiscountPct: string
  monthlyDiscountPct: string
  seasonalOptOut: boolean
}

export const EMPTY_STAY_PRICING: StayPricingDraft = { weekendPrice: '', weeklyDiscountPct: '', monthlyDiscountPct: '', seasonalOptOut: false }

const digits = (value: string) => value.replace(/[^\d]/g, '')
const pct = (value: string, max: number) => Math.min(max, Number(digits(value)) || 0)

export function stayPricingPayload(draft: StayPricingDraft) {
  const weekend = Number(digits(draft.weekendPrice))
  return {
    weekendPriceMinor: weekend > 0 ? weekend : null,
    weeklyDiscountPct: pct(draft.weeklyDiscountPct, 50),
    monthlyDiscountPct: pct(draft.monthlyDiscountPct, 70),
    seasonalOptOut: draft.seasonalOptOut,
  }
}

export function stayPricingProblem(draft: StayPricingDraft, basePrice: number, lang: Lang) {
  const weekend = Number(digits(draft.weekendPrice))
  if (weekend && basePrice && weekend > basePrice * 10) {
    return pick(lang, 'سعر نهاية الأسبوع أكبر من 10 أضعاف السعر العادي. تحقق من الأصفار.', 'The weekend price is more than 10x the nightly price. Check the zeros.', 'Le prix du week-end dépasse 10 fois le prix normal. Vérifiez les zéros.')
  }
  if (Number(digits(draft.weeklyDiscountPct)) > 50) return pick(lang, 'أقصى خصم أسبوعي 50٪.', 'The weekly discount is at most 50%.', 'Remise hebdomadaire : 50 % maximum.')
  if (Number(digits(draft.monthlyDiscountPct)) > 70) return pick(lang, 'أقصى خصم شهري 70٪.', 'The monthly discount is at most 70%.', 'Remise mensuelle : 70 % maximum.')
  return ''
}

// Weekday names for the configured weekend nights (0 = Sunday), in the page language.
export function weekendNightNames(nights: number[], lang: Lang) {
  const locale = lang === 'ar' ? 'ar' : lang === 'fr' ? 'fr' : 'en'
  const format = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
  // 2026-11-01 is a Sunday.
  return nights.map((day) => format.format(new Date(Date.UTC(2026, 10, 1 + day)))).join(pick(lang, ' و', ' & ', ' et '))
}

function money(value: number, currency: string, lang: Lang) {
  const locale = lang === 'ar' ? 'ar-SY' : lang === 'fr' ? 'fr-CA' : 'en-US'
  return `${Math.round(value).toLocaleString(locale)} ${currency === 'USD' ? 'USD' : pick(lang, 'ل.س', 'SYP', 'SYP')}`
}

export function StayPricingFields({
  lang,
  draft,
  onChange,
  basePrice,
  currency,
  weekendNights = [],
}: {
  lang: Lang
  draft: StayPricingDraft
  onChange: (draft: StayPricingDraft) => void
  basePrice: number
  currency: string
  weekendNights?: number[]
}) {
  const nightNames = weekendNightNames(weekendNights, lang)
  const set = (patch: Partial<StayPricingDraft>) => onChange({ ...draft, ...patch })
  const weekend = Number(digits(draft.weekendPrice)) || 0
  const weekly = pct(draft.weeklyDiscountPct, 50)
  const monthly = pct(draft.monthlyDiscountPct, 70)
  // Example week: one of each weekday, so the weekend nights appear once each.
  const weekendCount = Math.min(7, weekendNights.length)
  const weekSubtotal = basePrice * (7 - weekendCount) + (weekend || basePrice) * weekendCount
  const weekTotal = weekSubtotal - Math.round((weekSubtotal * weekly) / 100)
  const problem = stayPricingProblem(draft, basePrice, lang)

  return (
    <div className="stay-pricing-fields" data-testid="stay-pricing-fields">
      <strong>{pick(lang, 'تسعير متغير (اختياري)', 'Variable pricing (optional)', 'Tarification variable (optionnel)')}</strong>
      <p>{pick(lang, 'مثل Airbnb: أنت تحدد السعر. اترك الحقل فارغاً إذا لا تريده.', 'Like Airbnb: you set the price. Leave a field empty if you don’t want it.', 'Comme Airbnb : vous fixez le prix. Laissez vide si vous n’en voulez pas.')}</p>
      <div className="stay-pricing-grid">
        <label>
          <span>
            {pick(lang, 'سعر ليلة نهاية الأسبوع', 'Weekend night price', 'Prix d’une nuit de week-end')}
            {nightNames ? ` (${pick(lang, 'ليلة', 'nights of', 'nuits du')} ${nightNames})` : ''}
          </span>
          <input
            data-testid="pricing-weekend"
            dir="ltr"
            inputMode="numeric"
            placeholder={basePrice ? String(Math.round(basePrice * 1.2)) : ''}
            value={draft.weekendPrice}
            onChange={(event) => set({ weekendPrice: digits(event.target.value) })}
          />
        </label>
        <label>
          <span>{pick(lang, 'خصم أسبوعي (7 ليالٍ أو أكثر) ٪', 'Weekly discount (7+ nights) %', 'Remise semaine (7+ nuits) %')}</span>
          <input data-testid="pricing-weekly" dir="ltr" inputMode="numeric" placeholder="10" value={draft.weeklyDiscountPct} onChange={(event) => set({ weeklyDiscountPct: digits(event.target.value).slice(0, 2) })} />
        </label>
        <label>
          <span>{pick(lang, 'خصم شهري (28 ليلة أو أكثر) ٪', 'Monthly discount (28+ nights) %', 'Remise mois (28+ nuits) %')}</span>
          <input data-testid="pricing-monthly" dir="ltr" inputMode="numeric" placeholder="20" value={draft.monthlyDiscountPct} onChange={(event) => set({ monthlyDiscountPct: digits(event.target.value).slice(0, 2) })} />
        </label>
      </div>
      <label className="stay-pricing-check">
        <input data-testid="pricing-seasons" type="checkbox" checked={!draft.seasonalOptOut} onChange={(event) => set({ seasonalOptOut: !event.target.checked })} />
        <span>
          {pick(
            lang,
            'تطبيق أسعار المواسم من Rezekme (مثل العيد والصيف): زيادة بنسبة تحددها الإدارة في تلك الأيام فقط.',
            'Apply Rezekme high-season pricing (e.g. Eid, summer): a % increase set by Rezekme, on those dates only.',
            'Appliquer la haute saison Rezekme (Aïd, été) : une hausse en % fixée par Rezekme, ces dates seulement.',
          )}
        </span>
      </label>
      {basePrice > 0 && (
        <p className="stay-pricing-example" data-testid="pricing-example">
          {pick(lang, 'مثال لأسبوع (7 ليالٍ): ', 'Example week (7 nights): ', 'Exemple semaine (7 nuits) : ')}
          <b>{money(weekTotal, currency, lang)}</b>
          {weekly > 0 && <> ({pick(lang, `بعد خصم ${weekly}٪`, `after ${weekly}% off`, `après ${weekly} % de remise`)})</>}
          {monthly > 0 && <> · {pick(lang, `28 ليلة: خصم ${monthly}٪`, `28 nights: ${monthly}% off`, `28 nuits : ${monthly} % de remise`)}</>}
        </p>
      )}
      <p className="stay-pricing-note">
        {pick(lang, 'يمكنك أيضاً تحديد سعر خاص لأي يوم من تقويم لوحة المضيف.', 'You can also set a special price for any date from the calendar in your host dashboard.', 'Vous pouvez aussi fixer un prix pour une date précise depuis le calendrier de votre tableau de bord.')}
      </p>
      {problem && <p className="stay-pricing-problem">{problem}</p>}
    </div>
  )
}
