import { useEffect, useMemo, useRef, useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  createPrototypeBooking,
  createStripeCheckoutSession,
  fetchBookingQuote,
  fetchListingAvailability,
  fetchPrototypeBooking,
  fetchPrototypeListing,
  getStoredGuestSession,
  type BookingQuote,
  type PlatformBooking,
  type PlatformListing,
} from '../../shared/api/platformApi'
import { cancellationRuleText, freeCancellationLabel } from '../../shared/booking/cancellationPolicy'
import { stayGuestAgreement } from '../../shared/booking/guestAgreement'
import { divisionText, moneyText } from '../../shared/i18n/display'
import { listingDisplayTitle } from '../../shared/listing/displayTitle'
import { GuestAccountPage } from '../account/GuestAccountPage'
import { DateRangePicker, formatDateForLang, isValidDate, nightsBetween, type DateRange } from '../search/DateRangePicker'
import { guestFeeSummary } from './guestFeeSummary'
import { CHECKOUT_DRAFT_KEY, CHECKOUT_NOTE_KEY_PREFIX, STRIPE_PENDING_KEY_PREFIX, loadCheckoutDraft, saveCheckoutDraft } from './checkoutDraft'

// Airbnb-style "Confirm and pay": the listing page's Reserve button lands here with the guest's
// choices in sessionStorage (CHECKOUT_DRAFT_KEY). Sign-in happens inline, the booking is created
// only when the guest presses "Confirm and pay", then the chosen rail takes over (Stripe Checkout
// for cards, the receipt-upload page for Sham Cash / bank transfer).

type PaymentMethod = 'card' | 'shamCash' | 'bank'

type Props = {
  listingId: string
  lang: Lang
}

const DIVISION_IMAGES: Record<string, string> = {
  STAYS: '/assets/divisions/daily-rental.webp',
}

export function CheckoutPage({ listingId, lang }: Props) {
  const isAr = lang === 'ar'
  const colon = lang === 'fr' ? ' : ' : ': '
  const initialDraft = useMemo(() => loadCheckoutDraft(listingId), [listingId])
  const [listing, setListing] = useState<PlatformListing | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [dateRange, setDateRange] = useState<DateRange>({ checkIn: initialDraft?.checkIn || '', checkOut: initialDraft?.checkOut || '' })
  const [protection, setProtection] = useState(initialDraft?.protection ?? false)
  const [guests, setGuests] = useState(Math.max(1, initialDraft?.guests || 1))
  const [showPicker, setShowPicker] = useState(false)
  const [disabledDates, setDisabledDates] = useState<Set<string>>(new Set())
  const [quote, setQuote] = useState<BookingQuote | null>(null)
  const [quoteState, setQuoteState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [method, setMethod] = useState<PaymentMethod | ''>('')
  const [agreed, setAgreed] = useState(false)
  const [signedIn, setSignedIn] = useState(() => Boolean(getStoredGuestSession()))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [cardUnavailable, setCardUnavailable] = useState(false)
  // A booking created by an earlier click (e.g. the card call failed afterwards) is reused, so a
  // second click never creates a second PAYMENT_PENDING booking for the same dates.
  const [createdBooking, setCreatedBooking] = useState<PlatformBooking | null>(null)
  const errorRef = useRef<HTMLDivElement | null>(null)
  const agreement = stayGuestAgreement(lang)

  const title = listing ? listingDisplayTitle(listing, lang) || `${divisionText(listing.division, lang)} ${listing.id.slice(0, 8).toUpperCase()}` : ''
  const nights = isValidDate(dateRange.checkIn) && isValidDate(dateRange.checkOut) ? nightsBetween(dateRange.checkIn, dateRange.checkOut) : 0
  const hasDates = nights >= 1
  const isDemo = listing?.metadata?.demo === true
  const notStays = Boolean(listing && listing.division !== 'STAYS')
  const quoteReason = quote && quote.bookable === false ? quote.reason || 'LISTING_NOT_BOOKABLE' : ''
  const blocked = isDemo || notStays || (quoteReason !== '' && quoteReason !== 'BOOKING_DATES_UNAVAILABLE')
  const maxGuests = typeof listing?.metadata?.maxGuests === 'number' ? Math.max(1, listing.metadata.maxGuests as number) : 16
  const location = listing?.location as Record<string, unknown> | undefined
  // One script only: Arabic UI -> Arabic names (area, governorate); EN/FR -> Latin names (areaEn, city).
  const isArabicText = (value: unknown) => typeof value === 'string' && /[\u0600-\u06FF]/.test(value)
  const placeCandidates = isAr
    ? [location?.area, location?.governorate, location?.city]
    : [listing?.metadata?.areaEn, location?.area, location?.city, location?.governorate]
  const placeLabel = placeCandidates
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '' && (isAr ? isArabicText(part) : !isArabicText(part)))
    .filter((part, index, all) => all.indexOf(part) === index)
    .slice(0, 2)
    .join(isAr ? '، ' : ', ')
  const photo = listing
    ? (listing.media || []).map((item) => item.url || item.src || item.assetUrl).find((value): value is string => typeof value === 'string')
    : undefined

  const canConfirm = signedIn && hasDates && agreed && method !== '' && !blocked && quoteReason === '' && quoteState !== 'loading' && !submitting

  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    fetchPrototypeListing(listingId)
      .then((loaded) => {
        if (cancelled) return
        setListing(loaded)
        setLoadState('ready')
      })
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })
    const from = toISODate(new Date())
    const to = toISODate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 180))
    fetchListingAvailability(listingId, from, to)
      .then((response) => {
        if (cancelled) return
        const blockedDays = new Set(response.blockedDates)
        response.bookedRanges.forEach((range) => {
          let day = new Date(`${range.checkIn}T00:00:00`)
          const end = new Date(`${range.checkOut}T00:00:00`)
          while (day < end) {
            blockedDays.add(toISODate(day))
            day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
          }
        })
        setDisabledDates(blockedDays)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [listingId])

  useEffect(() => {
    const sync = () => setSignedIn(Boolean(getStoredGuestSession()))
    window.addEventListener('sybnb-session-changed', sync)
    return () => window.removeEventListener('sybnb-session-changed', sync)
  }, [])

  // Keep the draft current so a reload, the inline sign-in, or "back to listing" keeps every choice.
  useEffect(() => {
    saveCheckoutDraft({ listingId, checkIn: dateRange.checkIn, checkOut: dateRange.checkOut, protection, guests })
  }, [listingId, dateRange.checkIn, dateRange.checkOut, protection, guests])

  // Re-quote whenever dates or protection change. A new quote also means any booking created for the
  // old choices no longer matches, so it is not reused.
  useEffect(() => {
    setCreatedBooking(null)
    if (!hasDates) {
      setQuote(null)
      setQuoteState('idle')
      return
    }
    let cancelled = false
    setQuoteState('loading')
    const timer = window.setTimeout(() => {
      fetchBookingQuote({ listingId, checkIn: dateRange.checkIn, checkOut: dateRange.checkOut, protection })
        .then((next) => {
          if (cancelled) return
          setQuote(next)
          setQuoteState('idle')
        })
        .catch(() => {
          if (cancelled) return
          setQuote(null)
          setQuoteState('error')
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [listingId, dateRange.checkIn, dateRange.checkOut, protection, hasDates])

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

  function errorText(err: unknown) {
    const code = (err as { code?: string } | null)?.code
    if (code === 'LISTING_NOT_BOOKABLE') return isDemo ? t('demo') : t('notBookable')
    if (code === 'OWN_LISTING') return t('ownListing')
    if (code === 'BOOKING_DATES_UNAVAILABLE') return t('datesTaken')
    if (code === 'BOOKING_DATES_INVALID') return t('datesInvalid')
    if (code === 'BOOKING_NOT_PAYABLE') return t('notPayable')
    return err instanceof Error && err.message ? err.message : t('genericError')
  }

  function t(key: keyof typeof COPY) {
    const [ar, en, fr] = COPY[key]
    return pick<string>(lang, ar, en, fr)
  }

  async function confirmAndPay() {
    if (!listing || !quote || !canConfirm) return
    setSubmitting(true)
    setError('')
    let booking = createdBooking
    try {
      if (!booking) {
        booking = await createPrototypeBooking({
          listingId: listing.id,
          amountMinor: quote.stayMinor,
          currency: listing.currency,
          checkIn: dateRange.checkIn,
          checkOut: dateRange.checkOut,
          cancellationProtectionPurchased: protection,
          cancellationProtectionFeeMinor: protection ? quote.protectionMinor : undefined,
          acceptedTerms: true,
          termsVersion: agreement.version,
        })
        setCreatedBooking(booking)
      }
    } catch (err) {
      setError(errorText(err))
      setSubmitting(false)
      return
    }

    // The booking page holds the one-time ID-photo step that precedes any payment (card or
    // transfer). Look the booking up once: it tells us whether that step is still open and gives
    // the fee snapshot the payable total is computed from.
    let detailed: (PlatformBooking & { listing?: PlatformListing }) | null = null
    try {
      detailed = await fetchPrototypeBooking(booking.id)
    } catch {
      detailed = null
    }
    if (detailed?.guest && !detailed.guest.idDocumentRef) {
      try {
        sessionStorage.setItem(`${CHECKOUT_NOTE_KEY_PREFIX}${booking.id}`, method)
      } catch {
        // the booking page still shows its ID step without the note
      }
      sessionStorage.removeItem(CHECKOUT_DRAFT_KEY)
      window.location.hash = `/booking/${booking.id}`
      return
    }

    if (method === 'card') {
      try {
        const session = await createStripeCheckoutSession(booking.id)
        try {
          sessionStorage.setItem(`${STRIPE_PENDING_KEY_PREFIX}${booking.id}`, '1')
          sessionStorage.removeItem(CHECKOUT_DRAFT_KEY)
        } catch {
          // ignore
        }
        window.location.href = session.url
      } catch (err) {
        const code = (err as { code?: string; status?: number } | null)?.code
        const status = (err as { status?: number } | null)?.status
        if (code === 'PAYMENTS_DISABLED' || code === 'PAYMENT_POLICY_DENIED' || code === 'STRIPE_NOT_CONFIGURED' || status === 503) {
          setCardUnavailable(true)
          setMethod('')
          setError(t('cardUnavailable'))
        } else {
          setError(errorText(err))
        }
        setSubmitting(false)
      }
      return
    }

    const fees = guestFeeSummary({
      amountMinor: (detailed || booking).amountMinor,
      listing: { division: listing.division, metadata: listing.metadata },
      metadata: (detailed || booking).metadata,
    })
    sessionStorage.removeItem(CHECKOUT_DRAFT_KEY)
    window.location.hash = `/payment/local-wallet/${booking.id}/${fees.totalMinor}/${encodeURIComponent(booking.currency)}`
  }

  const backToListing = () => (window.location.hash = `/listing/${listingId}`)

  const priceRows = quote
    ? [
        { label: `${moneyText(Math.round(quote.stayMinor / Math.max(1, quote.nights)), quote.currency, lang)} × ${quote.nights} ${nightsWord(quote.nights, lang)}`, value: quote.stayMinor },
        { label: t('cleaning'), value: quote.cleaningMinor },
        { label: t('taxes'), value: quote.taxesMinor },
        { label: t('otherFees'), value: quote.otherFeesMinor },
        ...(protection ? [{ label: t('protectionFee'), value: quote.protectionMinor }] : []),
      ].filter((row, index) => index === 0 || row.value > 0)
    : []

  return (
    <main className="checkout-page" dir={isAr ? 'rtl' : 'ltr'}>
      <header className="checkout-header">
        <button type="button" className="checkout-back" onClick={backToListing} aria-label={t('backToListing')}>
          <span aria-hidden="true">{isAr ? '›' : '‹'}</span>
        </button>
        <h1>{t('title')}</h1>
      </header>

      {loadState === 'loading' && <section className="checkout-card">{t('loading')}</section>}
      {loadState === 'error' && (
        <section className="checkout-card checkout-alert" role="alert">
          <strong>{t('loadError')}</strong>
          <button type="button" className="checkout-secondary" onClick={() => (window.location.hash = '/stays')}>
            {t('browse')}
          </button>
        </section>
      )}

      {listing && (
        <div className="checkout-grid">
          <div className="checkout-main">
            {(isDemo || notStays || (quoteReason && quoteReason !== 'BOOKING_DATES_UNAVAILABLE')) && (
              <section className="checkout-card checkout-alert" role="note">
                <strong>
                  {isDemo ? t('demo') : quoteReason === 'OWN_LISTING' ? t('ownListing') : t('notBookable')}
                </strong>
                <button type="button" className="checkout-secondary" onClick={backToListing}>
                  {t('backToListing')}
                </button>
              </section>
            )}

            <section className="checkout-card" aria-labelledby="checkout-trip">
              <h2 id="checkout-trip">{t('yourTrip')}</h2>
              <div className="checkout-row">
                <div>
                  <strong>{t('dates')}</strong>
                  <span className="checkout-muted">
                    {hasDates
                      ? `${formatDateForLang(dateRange.checkIn, lang)} – ${formatDateForLang(dateRange.checkOut, lang)} · ${nights} ${nightsWord(nights, lang)}`
                      : t('noDates')}
                  </span>
                </div>
                <button type="button" className="checkout-link" onClick={() => setShowPicker((value) => !value)} aria-expanded={showPicker}>
                  {showPicker ? t('done') : t('edit')}
                </button>
              </div>
              {showPicker && (
                <div className="checkout-picker">
                  <DateRangePicker
                    lang={lang}
                    value={dateRange}
                    onChange={setDateRange}
                    onClose={() => setShowPicker(false)}
                    disabledDates={disabledDates}
                    disabledHint={t('datesTaken')}
                  />
                </div>
              )}
              {quoteReason === 'BOOKING_DATES_UNAVAILABLE' && <p className="checkout-warning">{t('datesTaken')}</p>}
              <div className="checkout-row">
                <div>
                  <strong>{t('guests')}</strong>
                  <span className="checkout-muted">{guestsWord(guests, lang)}</span>
                </div>
                <div className="checkout-stepper" role="group" aria-label={t('guests')}>
                  <button type="button" onClick={() => setGuests((value) => Math.max(1, value - 1))} disabled={guests <= 1} aria-label={t('fewerGuests')}>
                    −
                  </button>
                  <output aria-live="polite">{guests}</output>
                  <button type="button" onClick={() => setGuests((value) => Math.min(maxGuests, value + 1))} disabled={guests >= maxGuests} aria-label={t('moreGuests')}>
                    +
                  </button>
                </div>
              </div>
            </section>

            <section className="checkout-card" aria-labelledby="checkout-protection">
              <h2 id="checkout-protection">{t('protectionTitle')}</h2>
              <div className="checkout-options" role="radiogroup" aria-labelledby="checkout-protection">
                {([false, true] as const).map((value) => (
                  <label key={String(value)} className={`checkout-option${protection === value ? ' is-selected' : ''}`}>
                    <input type="radio" name="checkout-protection" checked={protection === value} onChange={() => setProtection(value)} />
                    <span className="checkout-option-body">
                      <strong>{value ? t('protected') : t('regular')}</strong>
                      <span>{cancellationRuleText(value, lang)}</span>
                      {hasDates && <small>{freeCancellationLabel(dateRange.checkIn, value, lang)}</small>}
                      {value && <small>{t('protectionNote')}</small>}
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="checkout-card" aria-labelledby="checkout-method">
              <h2 id="checkout-method">{t('paymentMethod')}</h2>
              <div className="checkout-options" role="radiogroup" aria-labelledby="checkout-method">
                {(['card', 'shamCash', 'bank'] as const).map((value) => {
                  const disabled = value === 'card' && cardUnavailable
                  return (
                    <label key={value} className={`checkout-option${method === value ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}>
                      <input type="radio" name="checkout-method" checked={method === value} disabled={disabled} onChange={() => setMethod(value)} />
                      <span className="checkout-option-icon" aria-hidden="true">
                        {value === 'card' ? '💳' : value === 'shamCash' ? '📱' : '🏦'}
                      </span>
                      <span className="checkout-option-body">
                        <strong>{value === 'card' ? t('card') : value === 'shamCash' ? t('shamCash') : t('bank')}</strong>
                        <span>{disabled ? t('cardUnavailableShort') : value === 'card' ? t('cardNote') : t('transferNote')}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </section>

            <section className="checkout-card">
              <label className="checkout-agreement">
                <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
                <span>
                  <strong>{agreement.title}</strong>
                  <small>{agreement.body}</small>
                  <em>{agreement.versionLabel}</em>
                </span>
              </label>
            </section>

            {!signedIn && !blocked && (
              <section className="checkout-account" aria-label={t('signInTitle')}>
                <GuestAccountPage
                  lang={lang}
                  embedded
                  embeddedTitle={t('signInTitle')}
                  onSignedIn={() => setSignedIn(true)}
                />
              </section>
            )}

            {error && (
              <div ref={errorRef} className="checkout-card checkout-alert" role="alert">
                {error}
              </div>
            )}

            {!blocked && (
              <section className="checkout-submit">
                <button type="button" className="checkout-primary" disabled={!canConfirm} onClick={() => void confirmAndPay()}>
                  {submitting ? t('working') : t('confirmAndPay')}
                </button>
                {!canConfirm && !submitting && <small className="checkout-muted">{missingHint()}</small>}
                <small className="checkout-fineprint">{t('fineprint')}</small>
              </section>
            )}
          </div>

          <aside className="checkout-summary" aria-label={t('summary')}>
            <div className="checkout-summary-card">
              <div className="checkout-listing">
                <img
                  src={photo || DIVISION_IMAGES.STAYS}
                  alt=""
                  onError={(event) => {
                    if (!event.currentTarget.src.endsWith(DIVISION_IMAGES.STAYS)) event.currentTarget.src = DIVISION_IMAGES.STAYS
                  }}
                />
                <div>
                  <strong>{title}</strong>
                  <span className="checkout-muted">{placeLabel || divisionText(listing.division, lang)}</span>
                </div>
              </div>
              <div className="checkout-separator" />
              <h2>{t('priceDetails')}</h2>
              {!hasDates ? (
                <p className="checkout-muted">{t('pickDatesForPrice')}</p>
              ) : quoteState === 'loading' ? (
                <p className="checkout-muted">{t('quoteLoading')}</p>
              ) : quoteState === 'error' || !quote ? (
                <p className="checkout-warning">{t('quoteError')}</p>
              ) : (
                <>
                  <dl className="checkout-prices">
                    {priceRows.map((row) => (
                      <div key={row.label}>
                        <dt>{row.label}</dt>
                        <dd>{moneyText(row.value, quote.currency, lang)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="checkout-separator" />
                  <div className="checkout-total">
                    <span>
                      {t('total')} ({quote.currency})
                    </span>
                    <strong>{moneyText(quote.totalMinor, quote.currency, lang)}</strong>
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </main>
  )

  function missingHint() {
    if (!hasDates) return t('needDates')
    if (method === '') return t('needMethod')
    if (!agreed) return t('needAgreement')
    if (!signedIn) return t('needSignIn')
    return ''
  }
}

function toISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function nightsWord(count: number, lang: Lang) {
  if (lang === 'ar') return count === 1 ? 'ليلة' : count === 2 ? 'ليلتان' : count <= 10 ? 'ليالٍ' : 'ليلة'
  if (lang === 'fr') return count > 1 ? 'nuits' : 'nuit'
  return count === 1 ? 'night' : 'nights'
}

function guestsWord(count: number, lang: Lang) {
  if (lang === 'ar') return count === 1 ? 'ضيف واحد' : count === 2 ? 'ضيفان' : count <= 10 ? `${count} ضيوف` : `${count} ضيفاً`
  if (lang === 'fr') return `${count} ${count > 1 ? 'voyageurs' : 'voyageur'}`
  return `${count} ${count === 1 ? 'guest' : 'guests'}`
}

const COPY = {
  title: ['تأكيد ودفع', 'Confirm and pay', 'Confirmer et payer'],
  backToListing: ['العودة إلى الإعلان', 'Back to the listing', 'Retour à l’annonce'],
  loading: ['جار التحميل...', 'Loading...', 'Chargement...'],
  loadError: ['تعذر تحميل الإعلان.', 'Could not load this listing.', 'Impossible de charger l’annonce.'],
  browse: ['تصفح الإعلانات', 'Browse listings', 'Parcourir les annonces'],
  yourTrip: ['رحلتك', 'Your trip', 'Votre voyage'],
  dates: ['التواريخ', 'Dates', 'Dates'],
  noDates: ['لم تختر التواريخ بعد', 'No dates chosen yet', 'Aucune date choisie'],
  edit: ['تعديل', 'Edit', 'Modifier'],
  done: ['تم', 'Done', 'Terminé'],
  guests: ['الضيوف', 'Guests', 'Voyageurs'],
  fewerGuests: ['ضيف أقل', 'Fewer guests', 'Moins de voyageurs'],
  moreGuests: ['ضيف إضافي', 'More guests', 'Plus de voyageurs'],
  protectionTitle: ['اختر الحماية', 'Choose your protection', 'Choisissez votre protection'],
  regular: ['السعر العادي', 'Regular rate', 'Tarif standard'],
  protected: ['السعر المحمي', 'Protected rate', 'Tarif protégé'],
  protectionNote: ['رسوم الحماية: 3% من قيمة الإقامة كاملة', 'Protection fee: 3% of the full stay amount', 'Frais de protection : 3 % du montant total du séjour'],
  paymentMethod: ['طريقة الدفع', 'Payment method', 'Mode de paiement'],
  card: ['بطاقة (من خارج سوريا)', 'Card (from abroad)', 'Carte (depuis l’étranger)'],
  cardNote: ['دفع آمن عبر Stripe، يتأكد فوراً.', 'Secure payment via Stripe, confirmed instantly.', 'Paiement sécurisé via Stripe, confirmé immédiatement.'],
  shamCash: ['شام كاش', 'Sham Cash', 'Sham Cash'],
  bank: ['تحويل بنكي', 'Bank transfer', 'Virement bancaire'],
  transferNote: [
    'حوّل المبلغ ثم ارفع صورة الإيصال، ويراجعه فريق SYBNB.',
    'Transfer the amount, then upload a photo of the receipt for the SYBNB team to check.',
    'Virez le montant, puis téléversez une photo du reçu ; l’équipe SYBNB le vérifie.',
  ],
  cardUnavailable: [
    'الدفع بالبطاقة غير متاح حالياً — اختر شام كاش أو التحويل البنكي.',
    'Card payment is not available right now — choose Sham Cash or bank transfer.',
    'Le paiement par carte n’est pas disponible pour le moment — choisissez Sham Cash ou le virement bancaire.',
  ],
  cardUnavailableShort: ['غير متاح حالياً', 'Not available right now', 'Indisponible pour le moment'],
  signInTitle: ['سجّل الدخول أو أنشئ حساباً للمتابعة', 'Log in or sign up to continue', 'Connectez-vous ou inscrivez-vous pour continuer'],
  confirmAndPay: ['تأكيد والدفع', 'Confirm and pay', 'Confirmer et payer'],
  working: ['جار التأكيد...', 'Confirming...', 'Confirmation...'],
  fineprint: [
    'لن يتم تأكيد الحجز قبل الدفع. لديك 48 ساعة لإتمام الدفع بالتحويل.',
    'Your booking is not confirmed until it is paid. You have 48 hours to complete a transfer payment.',
    'La réservation n’est confirmée qu’après le paiement. Vous avez 48 heures pour effectuer le paiement par virement.',
  ],
  needDates: ['اختر تاريخ الدخول والخروج.', 'Choose check-in and check-out dates.', 'Choisissez les dates d’arrivée et de départ.'],
  needMethod: ['اختر طريقة الدفع.', 'Choose a payment method.', 'Choisissez un mode de paiement.'],
  needAgreement: ['وافق على اتفاقية الإيجار اليومي.', 'Accept the short-term rental agreement.', 'Acceptez le contrat de location de courte durée.'],
  needSignIn: ['سجّل الدخول أو أنشئ حساباً أعلاه.', 'Log in or sign up above.', 'Connectez-vous ou inscrivez-vous ci-dessus.'],
  summary: ['ملخص الحجز', 'Booking summary', 'Récapitulatif'],
  priceDetails: ['تفاصيل السعر', 'Price details', 'Détail du prix'],
  pickDatesForPrice: ['اختر التواريخ لعرض السعر الكامل.', 'Choose dates to see the full price.', 'Choisissez des dates pour voir le prix complet.'],
  quoteLoading: ['جار حساب السعر...', 'Calculating price...', 'Calcul du prix...'],
  quoteError: ['تعذر حساب السعر الآن. حاول مرة أخرى.', 'Could not calculate the price right now. Try again.', 'Impossible de calculer le prix pour le moment. Réessayez.'],
  cleaning: ['رسوم التنظيف', 'Cleaning fee', 'Frais de ménage'],
  taxes: ['الضرائب والرسوم المحلية', 'Taxes and local fees', 'Taxes et frais locaux'],
  otherFees: ['رسوم أخرى', 'Other fees', 'Autres frais'],
  protectionFee: ['رسوم الحماية', 'Protection fee', 'Frais de protection'],
  total: ['الإجمالي', 'Total', 'Total'],
  demo: ['هذا إعلان تجريبي للعرض فقط — لا يمكن حجزه', 'Demo listing — not bookable', 'Annonce de démonstration — non réservable'],
  notBookable: ['هذا الإعلان غير متاح للحجز حالياً', 'This listing is not bookable right now', 'Cette annonce n’est pas réservable pour le moment'],
  ownListing: ['لا يمكنك حجز إعلانك الخاص', 'You cannot book your own listing', 'Vous ne pouvez pas réserver votre propre annonce'],
  datesTaken: [
    'هذه التواريخ لم تعد متاحة. اختر تواريخ أخرى.',
    'These dates are no longer available. Choose other dates.',
    'Ces dates ne sont plus disponibles. Choisissez d’autres dates.',
  ],
  datesInvalid: ['التواريخ غير صالحة. اختر تاريخ دخول وخروج صحيحين.', 'These dates are not valid. Choose a valid check-in and check-out.', 'Ces dates ne sont pas valides. Choisissez une arrivée et un départ valides.'],
  notPayable: [
    'انتهت مهلة الدفع لهذا الحجز. أعد الحجز من جديد.',
    'The payment window for this booking has closed. Please book again.',
    'Le délai de paiement de cette réservation est écoulé. Veuillez réserver à nouveau.',
  ],
  genericError: ['حدث خطأ. حاول مرة أخرى.', 'Something went wrong. Try again.', 'Une erreur s’est produite. Réessayez.'],
} as const satisfies Record<string, readonly [string, string, string]>
