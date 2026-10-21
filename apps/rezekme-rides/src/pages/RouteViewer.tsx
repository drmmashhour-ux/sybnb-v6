import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MAP_STYLE_URL, ensureRtlText, pinEl } from '../maps/mapStyle'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { fetchRideRoute, type RideRouteRecord } from '@platform/shared/api/platformApi'

/**
 * Recorded route of a finished (or live) trip: the driver's GPS breadcrumbs from acceptance to the
 * end, with the key moments and any GPS gaps. Shown to the rider (Trips) and the driver (Earnings),
 * and mirrored in the admin trail. Security record for Syria: where the car and the driver were.
 */
export function RouteViewer({ rideId, lang, asDriver = false }: { rideId: string; lang: Lang; asDriver?: boolean }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [data, setData] = useState<RideRouteRecord | null>(null)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let off = false
    fetchRideRoute(rideId, asDriver).then((d) => { if (!off) setData(d) }).catch((e) => { if (!off) setError(e instanceof Error ? e.message : 'Failed') })
    return () => { off = true }
  }, [rideId, asDriver])

  const [mapFailed, setMapFailed] = useState(false)
  useEffect(() => {
    if (!data || !box.current || data.points.length === 0) return
    let cancelled = false
    let map: maplibregl.Map | null = null
    ensureRtlText()
    try {
      const path = data.points.map((p) => [p.lng, p.lat] as [number, number])
      map = new maplibregl.Map({ container: box.current, style: MAP_STYLE_URL, center: path[0], zoom: 13, attributionControl: { compact: true } })
      const m = map
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
      m.on('error', () => { if (!m.isStyleLoaded() && !cancelled) setMapFailed(true) })
      m.on('load', () => {
        if (cancelled) return
        m.addSource('trip', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: path } } })
        m.addLayer({ id: 'trip', type: 'line', source: 'trip', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000', 'line-width': 4, 'line-opacity': 0.9 } })
        // GPS gaps: dashed red between the two fixes around each gap
        const gapLines = data.gaps.flatMap((gap) => {
          const a = data.points.find((p) => p.at === gap.from)
          const b = data.points.find((p) => p.at === gap.to)
          return a && b ? [[[a.lng, a.lat], [b.lng, b.lat]]] : []
        })
        if (gapLines.length) {
          m.addSource('gaps', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: gapLines } } })
          m.addLayer({ id: 'gaps', type: 'line', source: 'gaps', paint: { 'line-color': '#b00020', 'line-width': 4, 'line-dasharray': [2, 2] } })
        }
        new maplibregl.Marker({ element: pinEl('start') }).setLngLat(path[0]).addTo(m)
        new maplibregl.Marker({ element: pinEl('end') }).setLngLat(path[path.length - 1]).addTo(m)
        const bounds = new maplibregl.LngLatBounds()
        path.forEach((pt) => bounds.extend(pt))
        m.fitBounds(bounds, { padding: 24, maxZoom: 17, duration: 0 })
      })
    } catch {
      setMapFailed(true)
    }
    return () => { cancelled = true; map?.remove() }
  }, [data, lang])

  if (error) return <p style={S.note}>{error}</p>
  if (!data) return <p style={S.muted}>{t('جارٍ التحميل…', 'Loading…', 'Chargement…')}</p>
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString(pick(lang, 'ar-SY', 'en-US', 'fr-CA'), { hour: '2-digit', minute: '2-digit' })
  const LABEL: Record<string, [string, string, string]> = {
    ACCEPTED: ['قبل السائق', 'Driver accepted', 'Chauffeur a accepté'],
    ARRIVING: ['وصل السائق', 'Driver arrived', 'Chauffeur arrivé'],
    PICKUP_VERIFIED: ['تم التحقق من الرمز', 'Pickup code confirmed', 'Code confirmé'],
    IN_PROGRESS: ['بدأت الرحلة', 'Trip started', 'Course démarrée'],
    COMPLETED: ['انتهت الرحلة', 'Trip finished', 'Course terminée'],
    CANCELLED: ['أُلغيت', 'Cancelled', 'Annulée'],
    SOS: ['تنبيه طوارئ', 'Emergency alert', 'Alerte urgence'],
  }
  return (
    <div style={S.wrap}>
      {data.points.length === 0 ? (
        <p style={S.muted}>{t('لا يوجد مسار مسجّل لهذه الرحلة.', 'No GPS route was recorded for this trip.', 'Aucun trajet GPS enregistré pour cette course.')}</p>
      ) : (
        mapFailed ? <p style={S.note}>{t('تعذّر تحميل الخريطة.', 'The map could not load.', 'La carte n’a pas pu se charger.')}</p> : <div ref={box} style={S.map} />
      )}
      <div style={S.muted}>
        {data.distanceKm} km · {data.points.length} {t('نقطة GPS', 'GPS points', 'points GPS')}
        {data.gaps.length > 0 && <span style={{ color: '#b00020' }}> · {data.gaps.length} {t('انقطاع GPS', 'GPS gap(s)', 'coupure(s) GPS')}</span>}
      </div>
      {data.milestones.filter((m) => LABEL[m.type]).map((m, i) => (
        <div key={i} style={S.row}><span>{pick(lang, ...(LABEL[m.type] as [string, string, string]))}</span><span dir="ltr">{fmt(m.at)}</span></div>
      ))}
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 8 },
  map: { height: 240, borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e5e5' },
  muted: { color: '#6b6b6b', fontSize: 13, margin: 0 },
  note: { color: '#9b1c12', fontSize: 13, margin: 0 },
  row: { display: 'flex', justifyContent: 'space-between', fontSize: 14, borderTop: '1px solid #eee', paddingTop: 6 },
}
