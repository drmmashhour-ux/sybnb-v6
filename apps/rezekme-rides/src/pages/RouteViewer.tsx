import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
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

  useEffect(() => {
    if (!data || !box.current || data.points.length === 0) return
    const map = L.map(box.current, { zoomControl: true, attributionControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map)
    const latlngs = data.points.map((p) => [p.lat, p.lng] as [number, number])
    const line = L.polyline(latlngs, { color: '#000', weight: 4, opacity: 0.9 }).addTo(map)
    const dot = (c: string) => L.divIcon({ className: '', html: `<div style="width:14px;height:14px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] })
    L.marker(latlngs[0], { icon: dot('#1a7f37') }).addTo(map)
    L.marker(latlngs[latlngs.length - 1], { icon: dot('#b00020') }).addTo(map)
    // GPS gaps: dashed red between the two fixes around each gap
    for (const g of data.gaps) {
      const a = data.points.find((p) => p.at === g.from)
      const b = data.points.find((p) => p.at === g.to)
      if (a && b) L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#b00020', weight: 4, dashArray: '6 8' }).addTo(map)
    }
    map.fitBounds(line.getBounds(), { padding: [24, 24] })
    return () => { map.remove() }
  }, [data])

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
        <div ref={box} style={S.map} />
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
