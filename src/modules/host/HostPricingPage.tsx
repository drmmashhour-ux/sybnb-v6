import { useEffect, useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { fetchHostListingPricing, saveHostListingPricing, type StaySeason } from '../../shared/api/platformApi'
import { EMPTY_STAY_PRICING, StayPricingFields, stayPricingPayload, stayPricingProblem, type StayPricingDraft } from './StayPricingFields'

// Host pricing editor for one stay (2026-10-22). Saving does NOT send the listing back to review.
export function HostPricingPage({ lang, listingId }: { lang: Lang; listingId: string }) {
  const [draft, setDraft] = useState<StayPricingDraft>(EMPTY_STAY_PRICING)
  const [basePrice, setBasePrice] = useState(0)
  const [currency, setCurrency] = useState('SYP')
  const [weekendNights, setWeekendNights] = useState<number[]>([])
  const [seasons, setSeasons] = useState<StaySeason[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchHostListingPricing(listingId)
      .then((view) => {
        if (cancelled) return
        setBasePrice(view.basePriceMinor)
        setCurrency(view.currency)
        setWeekendNights(view.weekendNights)
        setSeasons(view.seasons)
        setDraft({
          weekendPrice: view.pricing.weekendPriceMinor ? String(view.pricing.weekendPriceMinor) : '',
          weeklyDiscountPct: view.pricing.weeklyDiscountPct ? String(view.pricing.weeklyDiscountPct) : '',
          monthlyDiscountPct: view.pricing.monthlyDiscountPct ? String(view.pricing.monthlyDiscountPct) : '',
          seasonalOptOut: view.pricing.seasonalOptOut,
        })
        setState('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setMessage(error instanceof Error ? error.message : '')
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [listingId])

  async function save() {
    const problem = stayPricingProblem(draft, basePrice, lang)
    if (problem) {
      setMessage(problem)
      return
    }
    setState('saving')
    setMessage('')
    try {
      await saveHostListingPricing(listingId, stayPricingPayload(draft))
      setState('saved')
      setMessage(pick(lang, 'تم الحفظ. الأسعار الجديدة تُطبق على الحجوزات الجديدة فقط.', 'Saved. New prices apply to new bookings only.', 'Enregistré. Les nouveaux prix s’appliquent aux nouvelles réservations.'))
    } catch (error) {
      setState('ready')
      setMessage(error instanceof Error ? error.message : pick(lang, 'تعذر الحفظ.', 'Could not save.', 'Enregistrement impossible.'))
    }
  }

  return (
    <main className="seller-page host-pricing-page" dir={lang === 'ar' ? 'rtl' : 'ltr'} style={{ minHeight: '70vh' }}>
      <section className="seller-wizard-section" style={{ maxWidth: 760, margin: '24px auto', padding: 16 }}>
        <button type="button" className="seller-secondary-button" onClick={() => navigate('/host/stays')}>
          {pick(lang, '← لوحة المضيف', '← Host dashboard', '← Tableau de bord')}
        </button>
        <h1 style={{ margin: '16px 0 4px' }}>{pick(lang, 'التسعير', 'Pricing', 'Tarifs')}</h1>
        {state === 'loading' && <p>{pick(lang, 'جار التحميل…', 'Loading…', 'Chargement…')}</p>}
        {state === 'error' && <p className="stay-pricing-problem">{message || pick(lang, 'تعذر تحميل الإعلان.', 'Could not load this listing.', 'Impossible de charger l’annonce.')}</p>}
        {state !== 'loading' && state !== 'error' && (
          <>
            <p>
              {pick(lang, 'سعر الليلة الأساسي: ', 'Base nightly price: ', 'Prix de base par nuit : ')}
              <b dir="ltr">{basePrice.toLocaleString()} {currency}</b>
            </p>
            <StayPricingFields lang={lang} draft={draft} onChange={(next) => { setDraft(next); if (state === 'saved') setState('ready') }} basePrice={basePrice} currency={currency} weekendNights={weekendNights} />
            {seasons.length > 0 && (
              <div className="stay-pricing-seasons" data-testid="host-pricing-seasons">
                <strong>{pick(lang, 'مواسم Rezekme القادمة', 'Upcoming Rezekme seasons', 'Saisons Rezekme à venir')}</strong>
                <ul>
                  {seasons.map((season) => (
                    <li key={season.id}>
                      {season.name}: <span dir="ltr">{season.from} → {season.to}</span> · +{season.upliftPct}%
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" className="seller-primary-button" data-testid="host-pricing-save" disabled={state === 'saving'} onClick={() => void save()}>
                {state === 'saving' ? pick(lang, 'جار الحفظ…', 'Saving…', 'Enregistrement…') : pick(lang, 'حفظ الأسعار', 'Save prices', 'Enregistrer')}
              </button>
            </div>
            {message && <p className={state === 'saved' ? 'stay-pricing-ok' : 'stay-pricing-problem'} data-testid="host-pricing-message">{message}</p>}
          </>
        )}
      </section>
    </main>
  )
}
