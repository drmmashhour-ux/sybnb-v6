import { Suspense, lazy, useState, type CSSProperties } from 'react'
import { rememberPosition, type DropTarget, type LatLng, type MapCommand } from './mapTypes'

// The map is a separate lazy chunk: not fetched until mounted (the page mounts it after first paint, never on saveData / 2g).
const MapLibreRideMap = lazy(() => import('./MapLibreRideMap').then((m) => ({ default: m.MapLibreRideMap })))

type Props = {
  lang: string
  pickup?: LatLng | null
  dropoff?: LatLng | null
  stops?: LatLng[]
  driver?: LatLng | null
  dropTarget?: DropTarget | null
  phase?: 'approach' | 'trip' | null
  route?: LatLng[] | null
  onPick?: (target: DropTarget, point: LatLng) => void
  recenterLabel: string
  loadingLabel: string
}

/** Ride map (MapLibre + OpenFreeMap, keyless) plus the round "recenter / my location" button. */
export function RideMapView({ lang, pickup, dropoff, stops, driver, dropTarget, phase, route, onPick, recenterLabel, loadingLabel }: Props) {
  const [failed, setFailed] = useState(false)
  const [command, setCommand] = useState<MapCommand | null>(null)
  const [user, setUser] = useState<LatLng | null>(null)

  function recenter() {
    const hasPins = Boolean(pickup || dropoff || driver || (stops && stops.length))
    if (hasPins) {
      setCommand({ n: Date.now(), type: 'fit' })
      return
    }
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude }
        rememberPosition(point)
        setUser(point)
        setCommand({ n: Date.now(), type: 'center', point })
      },
      () => {},
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
    )
  }

  return (
    <div style={styles.wrap}>
      {failed ? (
        <div role="status" style={styles.notice}>
          {lang === 'ar' ? 'تعذّر تحميل الخريطة. أدخل العناوين كتابةً أو أعد تحميل الصفحة.' : lang === 'fr' ? 'La carte n’a pas pu se charger. Saisissez les adresses ou rechargez la page.' : 'The map could not load. Type the addresses or reload the page.'}
        </div>
      ) : (
        <Suspense fallback={<div style={styles.loading}>{loadingLabel}</div>}>
          <MapLibreRideMap pickup={pickup} dropoff={dropoff} stops={stops} driver={driver} userLocation={user} dropTarget={dropTarget} onPick={onPick} command={command} phase={phase} route={route} onProviderFail={() => setFailed(true)} />
        </Suspense>
      )}
      <button type="button" aria-label={recenterLabel} title={recenterLabel} style={styles.recenter} onClick={recenter}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { position: 'absolute', inset: 0, background: '#e9e9e9' },
  loading: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#6b6b6b', fontSize: 13 },
  notice: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', color: '#444', fontSize: 14, fontWeight: 600, background: '#ececec' },
  recenter: { position: 'absolute', insetInlineEnd: 12, bottom: 44, width: 44, height: 44, minHeight: 44, borderRadius: '50%', border: 0, background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,.25)', display: 'grid', placeItems: 'center', padding: 0, zIndex: 500 },
}
