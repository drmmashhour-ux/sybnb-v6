import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchSharedSrRide, resolveApiUrl, type PlatformSharedRide } from '../../shared/api/platformApi'
import { statusText } from '../../shared/i18n/display'
import { RideMap } from '../../shared/maps/RideMap'

type Props = {
  lang: Lang
  rideId: string
  exp: string
  sig: string
}

const copy = {
  ar: {
    title: 'متابعة رحلة سير',
    subtitle: 'رابط متابعة مباشرة -- بدون الحاجة لحساب.',
    status: 'حالة الرحلة',
    driver: 'السائق',
    loading: 'جار التحميل...',
    invalid: 'رابط المتابعة غير صالح أو انتهت صلاحيته.',
    verifiedDriver: 'هوية موثقة',
  },
  en: {
    title: 'Track an SR ride',
    subtitle: 'A live tracking link -- no account needed.',
    status: 'Ride status',
    driver: 'Driver',
    loading: 'Loading...',
    invalid: 'This tracking link is invalid or has expired.',
    verifiedDriver: 'Verified identity',
  },
}

export function SharedRidePage({ lang, rideId, exp, sig }: Props) {
  const isAr = lang === 'ar'
  const t = copy[isAr ? 'ar' : 'en']
  const [ride, setRide] = useState<PlatformSharedRide | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    function poll() {
      fetchSharedSrRide(rideId, exp, sig)
        .then((result) => {
          if (cancelled) return
          setRide(result)
          setStatus('ready')
        })
        .catch(() => {
          if (!cancelled) setStatus('error')
        })
    }
    poll()
    const interval = window.setInterval(poll, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [rideId, exp, sig])

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      {status === 'error' && <div style={styles.error}>{t.invalid}</div>}
      {status === 'loading' && <div style={styles.message}>{t.loading}</div>}

      {ride && (
        <article style={styles.card}>
          <div style={styles.stat}>
            <span>{t.status}</span>
            <strong dir={isAr ? 'rtl' : 'ltr'}>{statusText(ride.status, lang)}</strong>
          </div>
          {(ride.pickupCoords || ride.dropoffCoords || ride.driver?.location) && (
            <RideMap pickup={ride.pickupCoords} dropoff={ride.dropoffCoords} driverLocation={ride.driver?.location} />
          )}
          {ride.driver && (
            <>
              {ride.driver.driverProfile?.photoUrl && (
                <img src={resolveApiUrl(ride.driver.driverProfile.photoUrl)} alt="" style={styles.driverPhoto} />
              )}
              {ride.driver.isVerified && <span style={styles.verifiedBadge}>✓ {t.verifiedDriver}</span>}
              <div style={styles.stat}>
                <span>{t.driver}</span>
                <strong>
                  {ride.driver.displayName}
                  {ride.driver.driverProfile?.vehicleMake ? ` · ${ride.driver.driverProfile.vehicleMake} ${ride.driver.driverProfile.vehicleModel || ''}` : ''}
                </strong>
              </div>
            </>
          )}
        </article>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 560, margin: '0 auto' },
  title: { margin: 0, fontSize: 28 },
  subtitle: { color: '#9aa6ba', margin: 0 },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 12 },
  stat: { borderTop: '1px solid #263651', display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba', paddingTop: 9 },
  message: { border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#b7ffe8', padding: 12, fontWeight: 900 },
  error: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 12, fontWeight: 900 },
  driverPhoto: { width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid #263651' },
  verifiedBadge: { display: 'inline-block', width: 'fit-content', borderRadius: 999, background: 'rgba(32,210,155,.14)', border: '1px solid rgba(32,210,155,.4)', color: '#20d29b', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
}
