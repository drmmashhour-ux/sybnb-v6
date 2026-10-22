import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { fetchNavRoute, type NavRoute } from '../maps/roadRoute'
import { distanceToLine, formatDistance, metersBetween, stepArrow, stepText } from '../maps/navText'
import type { LatLng } from '../maps/mapTypes'

const RideMapView = lazy(() => import('../maps/RideMapView').then((m) => ({ default: m.RideMapView })))

type Props = {
  lang: Lang
  me: LatLng | null
  target: LatLng
  toDropoff: boolean
  pickup: LatLng | null
  dropoff: LatLng | null
  riderName: string
  onClose: () => void
  /** The ride's main action (slide to arrive / start / finish), shown in the bottom sheet. */
  action?: ReactNode
}

/**
 * In-app turn-by-turn navigation (Uber-style), so the driver never leaves Rezekme: full-screen map that
 * follows the car heading-up, a green banner with the next maneuver, and a bottom sheet with time,
 * distance and the ride action. Routing comes from our own /api/sr/route (no Google, no key).
 */
export function DriverNav({ lang, me, target, toDropoff, pickup, dropoff, riderName, onClose, action }: Props) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [route, setRoute] = useState<NavRoute | null>(null)
  const [stepIdx, setStepIdx] = useState(1)
  const [loading, setLoading] = useState(false)
  const lastFetchRef = useRef<{ at: number; from: LatLng } | null>(null)

  // (Re)route: first time, when the target changes, when the car leaves the line (>60 m), or every 45 s.
  useEffect(() => {
    if (!me) return
    const last = lastFetchRef.current
    const offRoute = route ? distanceToLine(me, route.points) > 60 : true
    const stale = !last || Date.now() - last.at > 45_000
    if (!offRoute && !stale) return
    if (last && Date.now() - last.at < 8_000) return
    lastFetchRef.current = { at: Date.now(), from: me }
    const controller = new AbortController()
    setLoading(true)
    void fetchNavRoute(me, target, controller.signal).then((r) => {
      setLoading(false)
      if (!r) return
      setRoute(r)
      setStepIdx(1)
    })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.lat, me?.lng, target.lat, target.lng])

  // Advance past maneuvers the car has reached.
  useEffect(() => {
    if (!route || !me) return
    let i = stepIdx
    while (i < route.steps.length - 1 && metersBetween(me, route.steps[i]) < 25) i++
    if (i !== stepIdx) setStepIdx(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.lat, me?.lng, route])

  const next = route && route.steps.length ? route.steps[Math.min(stepIdx, route.steps.length - 1)] : null
  const toNext = next && me ? metersBetween(me, next) : null
  const after = route && stepIdx + 1 < route.steps.length ? route.steps[stepIdx + 1] : null
  const remainingM = me ? (route ? remainingAlong(route, me) : metersBetween(me, target)) : null
  const remainingMin = remainingM !== null ? Math.max(1, Math.round(route?.durationS && route.distanceM ? (remainingM / route.distanceM) * (route.durationS / 60) : (remainingM / 1000 / 30) * 60)) : null
  const arrival = remainingMin !== null ? new Date(Date.now() + remainingMin * 60_000).toLocaleTimeString(pick(lang, 'ar-SY', 'en-US', 'fr-CA'), { hour: '2-digit', minute: '2-digit' }) : null

  return (
    <div style={S.wrap} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div style={S.map}>
        <Suspense fallback={null}>
          <RideMapView
            lang={lang}
            pickup={toDropoff ? null : pickup}
            dropoff={toDropoff ? dropoff : null}
            driver={me}
            route={route ? route.points : me ? [me, target] : null}
            follow
            recenterLabel={t('إعادة التمركز', 'Recenter', 'Recentrer')}
            loadingLabel={t('جار تحميل الخريطة…', 'Loading map…', 'Chargement de la carte…')}
          />
        </Suspense>
      </div>

      <div style={S.banner} role="status" aria-live="polite">
        <div style={S.arrow} aria-hidden="true">{next ? stepArrow(next) : '↑'}</div>
        <div style={{ minWidth: 0 }}>
          <div style={S.bannerDist}>{toNext !== null ? formatDistance(toNext, lang) : loading ? t('جارٍ حساب الطريق…', 'Finding the route…', 'Calcul de l’itinéraire…') : '—'}</div>
          <div style={S.bannerText}>{next ? stepText(next, lang) : me ? t('اتبع الخط على الخريطة', 'Follow the line on the map', 'Suivez la ligne sur la carte') : t('شغّل الموقع (GPS) لبدء الملاحة', 'Turn on location (GPS) to navigate', 'Activez la localisation (GPS)')}</div>
          {after && <div style={S.then}>{t('ثم', 'Then', 'Puis')} {stepArrow(after)}</div>}
        </div>
      </div>

      <div style={S.sheet}>
        <div style={S.row}>
          <div>
            <div style={S.big}>{remainingMin !== null ? `${remainingMin} ${t('د', 'min', 'min')}` : '—'}</div>
            <div style={S.muted}>
              {remainingM !== null ? formatDistance(remainingM, lang) : ''}
              {arrival ? ` · ${t('الوصول', 'Arrive', 'Arrivée')} ${arrival}` : ''}
            </div>
          </div>
          <button type="button" style={S.exit} onClick={onClose}>{t('إنهاء الملاحة', 'Exit', 'Quitter')}</button>
        </div>
        <div style={S.muted}>
          {toDropoff ? t('إلى وجهة', 'Dropping off', 'Dépose de') : t('استلام', 'Picking up', 'Prise en charge de')} <strong style={{ color: '#000' }}>{riderName}</strong>
        </div>
        {action}
      </div>
    </div>
  )
}

/** Remaining distance along the route from the point on it nearest the car to the end. */
function remainingAlong(route: NavRoute, me: LatLng): number {
  const pts = route.points
  let bestI = 0
  let bestD = Infinity
  for (let i = 0; i < pts.length; i++) {
    const d = metersBetween(me, pts[i])
    if (d < bestD) { bestD = d; bestI = i }
  }
  let sum = bestD
  for (let i = bestI; i + 1 < pts.length; i++) sum += metersBetween(pts[i], pts[i + 1])
  return sum
}

const S: Record<string, CSSProperties> = {
  wrap: { position: 'fixed', inset: 0, zIndex: 2000, background: '#e9e9e9' },
  map: { position: 'absolute', inset: 0 },
  banner: { position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', insetInline: 12, display: 'flex', gap: 14, alignItems: 'center', background: '#0b6b3a', color: '#fff', borderRadius: 16, padding: '14px 16px', boxShadow: '0 4px 14px rgba(0,0,0,.3)', zIndex: 600 },
  arrow: { fontSize: 40, lineHeight: 1, fontWeight: 700, width: 48, textAlign: 'center', flexShrink: 0 },
  bannerDist: { fontSize: 26, fontWeight: 800, lineHeight: 1.1 },
  bannerText: { fontSize: 16, fontWeight: 600, opacity: 0.95, overflow: 'hidden', textOverflow: 'ellipsis' },
  then: { marginTop: 6, fontSize: 13, background: 'rgba(0,0,0,.25)', borderRadius: 999, padding: '2px 10px', width: 'fit-content' },
  sheet: { position: 'absolute', insetInline: 0, bottom: 0, background: '#fff', borderRadius: '18px 18px 0 0', padding: '16px 16px max(16px, env(safe-area-inset-bottom))', boxShadow: '0 -4px 16px rgba(0,0,0,.18)', display: 'grid', gap: 10, zIndex: 600 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  big: { fontSize: 26, fontWeight: 800, color: '#0b6b3a' },
  muted: { color: '#6b6b6b', fontSize: 14 },
  exit: { minHeight: 44, border: 0, borderRadius: 999, background: '#eee', color: '#000', fontWeight: 700, padding: '0 18px' },
}
