import { Suspense, lazy, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { fetchSharedSrRide, resolveApiUrl, type PlatformSharedRide } from '@platform/shared/api/platformApi'
import { statusText } from '@platform/shared/i18n/display'
// Leaflet map is loaded on demand only (weak-connection friendly).
const RideMap = lazy(() => import('@platform/shared/maps/RideMap').then((m) => ({ default: m.RideMap })))

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
  fr: {
    title: 'Suivre une course SR',
    subtitle: 'Un lien de suivi en direct — aucun compte requis.',
    status: 'Statut de la course',
    driver: 'Chauffeur',
    loading: 'Chargement...',
    invalid: 'Ce lien de suivi est invalide ou a expiré.',
    verifiedDriver: 'Identité vérifiée',
  },
}

export function SharedRidePage({ lang, rideId, exp, sig }: Props) {
  const isAr = lang === 'ar'
  const t = copy[lang]
  const [ride, setRide] = useState<PlatformSharedRide | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [showMap, setShowMap] = useState(false)

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
            <>
              <button type="button" style={styles.mapButton} onClick={() => setShowMap((v) => !v)}>
                {showMap ? pick(lang, 'إخفاء الخريطة', 'Hide map', 'Masquer la carte') : pick(lang, 'عرض الخريطة', 'Show map', 'Afficher la carte')}
              </button>
              {showMap && (
                <Suspense fallback={<div style={styles.message}>{t.loading}</div>}>
                  <RideMap pickup={ride.pickupCoords} dropoff={ride.dropoffCoords} driverLocation={ride.driver?.location} />
                </Suspense>
              )}
            </>
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
  page: { minHeight: '100vh', background: '#fff', color: '#000', padding: '16px 16px 90px', display: 'grid', gap: 16, maxWidth: 520, margin: '0 auto', alignContent: 'start' },
  title: { margin: 0, fontSize: 28, fontWeight: 800 },
  subtitle: { color: '#6b6b6b', margin: 0 },
  card: { background: '#f6f6f6', borderRadius: 14, padding: 16, display: 'grid', gap: 12 },
  stat: { borderTop: '1px solid #e2e2e2', display: 'flex', justifyContent: 'space-between', gap: 12, color: '#4a4a4a', paddingTop: 9 },
  message: { background: '#f3f3f3', borderRadius: 10, padding: 12, fontWeight: 600 },
  error: { background: '#fde8e6', color: '#9b1c12', borderRadius: 10, padding: 12, fontWeight: 600 },
  driverPhoto: { width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', background: '#ddd' },
  verifiedBadge: { display: 'inline-block', width: 'fit-content', borderRadius: 999, background: '#e6f4ea', color: '#0a7d3b', fontWeight: 700, fontSize: 12, padding: '4px 10px' },
  mapButton: { minHeight: 44, border: 0, borderRadius: 999, background: '#eee', color: '#000', fontWeight: 700, padding: '0 18px', justifySelf: 'start' },
}
