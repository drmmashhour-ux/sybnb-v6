import { useEffect, useState } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { fetchPrototypeOverview, getStoredGuestSession, type PlatformOverview } from '@platform/shared/api/platformApi'
import { moneyText, statusText } from '@platform/shared/i18n/display'
import { listingDisplayTitle } from '@platform/shared/listing/displayTitle'

type Trip = PlatformOverview['bookings'][number]

// "Trips" tab: the guest's stay bookings (read-only list from /api/me/overview), each linking to
// the booking page where payment, cancellation and the receipt live.
export function TripsPage({ lang }: { lang: Lang }) {
  const signedIn = Boolean(getStoredGuestSession())
  const [trips, setTrips] = useState<Trip[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(signedIn ? 'loading' : 'ready')

  useEffect(() => {
    if (!signedIn) return
    let alive = true
    fetchPrototypeOverview()
      .then((overview) => {
        if (!alive) return
        setTrips(overview.bookings.filter((booking) => !booking.listing || String(booking.listing.division).toUpperCase() === 'STAYS'))
        setState('ready')
      })
      .catch(() => alive && setState('error'))
    return () => {
      alive = false
    }
  }, [signedIn])

  const title = pick(lang, 'رحلاتي', 'Trips', 'Voyages')

  if (!signedIn) {
    return (
      <main className="str-page str-narrow" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <h1 className="str-h1">{title}</h1>
        <p className="str-muted">{pick(lang, 'سجّل الدخول لرؤية حجوزاتك.', 'Log in to see your bookings.', 'Connectez-vous pour voir vos réservations.')}</p>
        <button type="button" className="str-btn str-btn-primary str-btn-inline" onClick={() => (window.location.hash = '/account/open')}>
          {pick(lang, 'تسجيل الدخول', 'Log in', 'Se connecter')}
        </button>
      </main>
    )
  }

  return (
    <main className="str-page str-narrow" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <h1 className="str-h1">{title}</h1>
      {state === 'loading' ? (
        <div className="str-list" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="str-skeleton str-skeleton-row" />)}
        </div>
      ) : state === 'error' ? (
        <p className="str-muted" role="alert">{pick(lang, 'تعذر تحميل الحجوزات. تحقق من الاتصال وحاول مجدداً.', 'Could not load your bookings. Check your connection and retry.', 'Impossible de charger vos réservations. Vérifiez la connexion.')}</p>
      ) : trips.length === 0 ? (
        <div className="str-empty">
          <p className="str-muted">{pick(lang, 'لا توجد حجوزات بعد.', 'No trips yet.', 'Aucun voyage pour le moment.')}</p>
          <button type="button" className="str-btn str-btn-outline str-btn-inline" onClick={() => (window.location.hash = '/stays')}>
            {pick(lang, 'ابدأ الاستكشاف', 'Start exploring', 'Commencer à explorer')}
          </button>
        </div>
      ) : (
        <div className="str-list">
          {trips.map((trip) => {
            const photo = trip.listing?.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string') as string | undefined
            return (
              <button key={trip.id} type="button" className="str-trip" onClick={() => (window.location.hash = `/booking/${trip.id}`)}>
                <span className="str-trip-photo">{photo ? <img src={photo} alt="" loading="lazy" decoding="async" width={96} height={96} /> : null}</span>
                <span className="str-trip-info">
                  <strong>{trip.listing ? listingDisplayTitle(trip.listing, lang) : trip.listingId.slice(0, 8)}</strong>
                  <span className="str-muted">{[trip.checkIn, trip.checkOut].filter(Boolean).join(' → ')}</span>
                  <span className="str-trip-meta">
                    <span className="str-tag">{statusText(trip.status, lang)}</span>
                    <span>{moneyText(trip.amountMinor, trip.currency, lang)}</span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </main>
  )
}
