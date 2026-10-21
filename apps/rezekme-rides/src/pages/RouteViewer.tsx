import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { loadGoogleMaps } from '../maps/googleLoader'
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
    loadGoogleMaps(lang)
      .then((g) => {
        if (cancelled || !box.current) return
        const map = new g.maps.Map(box.current, { disableDefaultUI: true, zoomControl: true, clickableIcons: false })
        const path = data.points.map((p) => ({ lat: p.lat, lng: p.lng }))
        new g.maps.Polyline({ map, path, strokeColor: '#000', strokeWeight: 4, strokeOpacity: 0.9 })
        const dot = (color: string) => ({ path: g.maps.SymbolPath.CIRCLE, scale: 7, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 })
        new g.maps.Marker({ map, position: path[0], icon: dot('#1a7f37') })
        new g.maps.Marker({ map, position: path[path.length - 1], icon: dot('#b00020') })
        // GPS gaps: dashed red between the two fixes around each gap
        for (const gap of data.gaps) {
          const a = data.points.find((p) => p.at === gap.from)
          const b = data.points.find((p) => p.at === gap.to)
          if (a && b) {
            new g.maps.Polyline({ map, path: [{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }], strokeOpacity: 0, strokeColor: '#b00020', icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: '#b00020', scale: 3 }, offset: '0', repeat: '14px' }] })
          }
        }
        const bounds = new g.maps.LatLngBounds()
        path.forEach((point) => bounds.extend(point))
        map.fitBounds(bounds, 24)
      })
      .catch(() => { if (!cancelled) setMapFailed(true) })
    return () => { cancelled = true }
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
        mapFailed ? <p style={S.note}>{t('تعذّر تحميل خريطة Google.', 'The Google map could not load.', 'La carte Google n’a pas pu se charger.')}</p> : <div ref={box} style={S.map} />
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
