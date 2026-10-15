import { Suspense, lazy, useEffect, useState, type CSSProperties } from 'react'
import { toPoint, type DropTarget, type LatLng } from './mapTypes'

const RideMapView = lazy(() => import('./RideMapView').then((m) => ({ default: m.RideMapView })))

type Props = {
  lang: string
  pickup?: LatLng | null
  dropoff?: LatLng | null
  stops?: LatLng[]
  driver?: LatLng | null
  dropTarget?: DropTarget | null
  /** Live-ride camera mode, see RideMapProps.phase. */
  phase?: 'approach' | 'trip' | null
  /** Compact status chip over the map (e.g. "Driver arrives in 3 min"). */
  banner?: string | null
  onPick?: (target: DropTarget, point: LatLng) => void
  /** Height of the hero (CSS value). The bottom sheet overlaps its lower edge. */
  height?: string
  labels: { show: string; hide: string; recenter: string; loading: string; tapHint?: string }
}

function isLowBandwidth(): boolean {
  const connection = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  return Boolean(connection && (connection.saveData === true || connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'))
}

/**
 * The map hero at the top of the screen. The map module is loaded lazily AFTER first paint (never in
 * the initial bundle). On data-saver / 2g connections it starts collapsed behind a "Show map" button.
 */
export function MapHero({ lang, pickup: rawPickup, dropoff: rawDropoff, stops: rawStops, driver: rawDriver, dropTarget, phase, banner, onPick, height = '46vh', labels }: Props) {
  // Server coordinates can arrive as numeric strings or with nulls: normalise once, drop anything invalid.
  const pickup = toPoint(rawPickup)
  const dropoff = toPoint(rawDropoff)
  const driver = toPoint(rawDriver)
  const stops = (rawStops || []).flatMap((stop) => {
    const point = toPoint(stop)
    return point ? [point] : []
  })
  const [collapsed, setCollapsed] = useState(() => isLowBandwidth())
  const [afterPaint, setAfterPaint] = useState(false)

  useEffect(() => {
    // Defer one frame + a tick so the sheet content paints first.
    const id = window.setTimeout(() => setAfterPaint(true), 60)
    return () => window.clearTimeout(id)
  }, [])

  if (collapsed) {
    return (
      <div style={styles.collapsed}>
        <button type="button" style={styles.showBtn} onClick={() => setCollapsed(false)}>
          {labels.show}
        </button>
      </div>
    )
  }
  return (
    <div style={{ ...styles.hero, height, minHeight: 260 }}>
      {afterPaint ? (
        <Suspense fallback={<div style={styles.skeleton}>{labels.loading}</div>}>
          <RideMapView
            lang={lang}
            pickup={pickup}
            dropoff={dropoff}
            stops={stops}
            driver={driver}
            dropTarget={dropTarget}
            phase={phase}
            onPick={onPick}
            recenterLabel={labels.recenter}
            loadingLabel={labels.loading}
          />
        </Suspense>
      ) : (
        <div style={styles.skeleton}>{labels.loading}</div>
      )}
      {banner && <div style={styles.banner} role="status">{banner}</div>}
      {dropTarget && labels.tapHint && <div style={styles.tapHint}>{labels.tapHint}</div>}
      <button type="button" style={styles.hideBtn} onClick={() => setCollapsed(true)}>
        {labels.hide}
      </button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  hero: { position: 'relative', background: '#e9e9e9', overflow: 'hidden', zIndex: 0 },
  skeleton: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#6b6b6b', fontSize: 13, background: '#ececec' },
  collapsed: { background: '#f3f3f3', padding: '12px 16px', display: 'flex', justifyContent: 'center' },
  showBtn: { minHeight: 44, border: 0, borderRadius: 999, background: '#000', color: '#fff', fontWeight: 700, padding: '0 22px' },
  banner: { position: 'absolute', top: 12, insetInline: 12, marginInline: 'auto', width: 'fit-content', maxWidth: 'calc(100% - 24px)', background: '#000', color: '#fff', borderRadius: 999, padding: '9px 16px', fontSize: 14, fontWeight: 700, textAlign: 'center', zIndex: 500, pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,.3)' },
  hideBtn: { position: 'absolute', insetInlineStart: 12, bottom: 44, minHeight: 36, border: 0, borderRadius: 999, background: '#fff', color: '#000', fontWeight: 700, fontSize: 12, padding: '0 14px', boxShadow: '0 2px 8px rgba(0,0,0,.2)', zIndex: 500 },
  tapHint: { position: 'absolute', insetInline: 12, top: 12, background: '#000', color: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 600, textAlign: 'center', zIndex: 500, pointerEvents: 'none' },
}
