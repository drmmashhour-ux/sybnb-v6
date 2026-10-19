import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Lang } from '../../engines/language/languageEngine'
import { pick } from '../../engines/language/languageEngine'
import { fetchAdminOps, fetchAdminRideRoute, type AdminOps, type AdminOpsRide } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'

type Props = { lang: Lang }

/**
 * Live operations hub (modelled on the Uber / Lyft ops console): KPI strip, one map with every active
 * ride (pickup, drop-off, the car's live position), work queues (driver documents, safety incidents),
 * and per-ride drill-down with the recorded GPS route. Refreshes every 10 seconds. Read-only.
 */
export function AdminOperationsPage({ lang }: Props) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [ops, setOps] = useState<AdminOps | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [route, setRoute] = useState<Array<{ lat: number; lng: number; at: string }> | null>(null)
  const [routeInfo, setRouteInfo] = useState('')
  const mapBox = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    let off = false
    const load = () => fetchAdminOps().then((d) => { if (!off) { setOps(d); setError('') } }).catch((e) => { if (!off) setError(e instanceof Error ? e.message : 'Failed') })
    void load()
    const id = window.setInterval(load, 10_000)
    return () => { off = true; window.clearInterval(id) }
  }, [])

  useEffect(() => {
    if (!mapBox.current || mapRef.current) return
    const map = L.map(mapBox.current).setView([34.8, 38.5], 6)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  const icon = (c: string, sq = false) => L.divIcon({ className: '', html: `<div style="width:14px;height:14px;border-radius:${sq ? '2px' : '50%'};background:${c};border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4)"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] })

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer || !ops) return
    layer.clearLayers()
    const pts: L.LatLngExpression[] = []
    for (const r of ops.rides) {
      const hot = r.id === selected
      if (r.pickupCoords) { L.marker([r.pickupCoords.lat, r.pickupCoords.lng], { icon: icon('#1a7f37') }).bindTooltip(`${r.pickup}`).addTo(layer); pts.push([r.pickupCoords.lat, r.pickupCoords.lng]) }
      if (r.dropoffCoords) { L.marker([r.dropoffCoords.lat, r.dropoffCoords.lng], { icon: icon('#333', true) }).bindTooltip(`${r.dropoff}`).addTo(layer) }
      if (r.driverLocation) {
        L.marker([r.driverLocation.lat, r.driverLocation.lng], { icon: icon(hot ? '#e11d48' : '#2563eb') }).bindTooltip(`${r.driver?.displayName ?? ''} · ${r.status}`).on('click', () => setSelected(r.id)).addTo(layer)
        pts.push([r.driverLocation.lat, r.driverLocation.lng])
      }
    }
    if (route && route.length > 1) {
      const line = L.polyline(route.map((p) => [p.lat, p.lng] as [number, number]), { color: '#e11d48', weight: 4 }).addTo(layer)
      map.fitBounds(line.getBounds(), { padding: [30, 30] })
    } else if (pts.length > 0 && !selected) {
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 })
    }
  }, [ops, selected, route])

  async function pickRide(r: AdminOpsRide) {
    setSelected(r.id)
    setRoute(null)
    setRouteInfo('')
    try {
      const d = await fetchAdminRideRoute(r.id)
      setRoute(d.points)
      setRouteInfo(`${d.distanceKm} km · ${d.points.length} GPS points${d.gaps.length ? ` · ${d.gaps.length} GPS gap(s)` : ''}`)
    } catch (e) {
      setRouteInfo(e instanceof Error ? e.message : 'Failed')
    }
  }

  const k = ops?.kpis
  const card = (label: string, value: string | number, tone?: 'warn' | 'bad', href?: string) => (
    <div key={label} style={{ ...S.kpi, ...(tone === 'warn' ? S.warn : tone === 'bad' ? S.bad : {}), cursor: href ? 'pointer' : 'default' }} onClick={href ? () => { window.location.hash = href } : undefined}>
      <div style={S.kpiValue}>{value}</div>
      <div style={S.kpiLabel}>{label}</div>
    </div>
  )

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} style={S.page}>
      <button style={S.back} onClick={() => (window.location.hash = '/admin/review')}>← {t('لوحة الإدارة', 'Admin panel', 'Panneau admin')}</button>
      <h1 style={S.title}>{t('العمليات المباشرة', 'Live operations', 'Opérations en direct')}</h1>
      {error && <p style={S.err}>{error}</p>}
      {k && (
        <div style={S.kpis}>
          {card(t('رحلات نشطة', 'Active rides', 'Courses actives'), k.active)}
          {card(t('قيد البحث عن سائق', 'Finding a driver', 'Recherche chauffeur'), k.searching, k.searching > 0 ? 'warn' : undefined)}
          {card(t('جارية الآن', 'On trip now', 'En course'), k.inProgress)}
          {card(t('فقدان GPS', 'GPS lost', 'GPS perdu'), k.gpsLost, k.gpsLost > 0 ? 'bad' : undefined)}
          {card(t('سائقون متصلون', 'Drivers online', 'Chauffeurs en ligne'), k.onlineDrivers)}
          {card(t('سائقون في الخدمة', 'Drivers on duty', 'Chauffeurs en service'), k.onDutyDrivers)}
          {card(t('مكتملة (24س)', 'Completed (24h)', 'Terminées (24h)'), k.completed24h)}
          {card(t('ملغاة (24س)', 'Cancelled (24h)', 'Annulées (24h)'), k.cancelled24h)}
          {card(t('إجمالي (24س)', 'Gross (24h)', 'Brut (24h)'), moneyText(k.gross24hMinor, 'USD', lang))}
          {card(t('عمولة المنصة (24س)', 'Platform fee (24h)', 'Frais plateforme (24h)'), moneyText(k.commission24hMinor, 'USD', lang))}
          {card(t('بلاغات سلامة مفتوحة', 'Open safety incidents', 'Incidents ouverts'), k.openIncidents, k.openIncidents > 0 ? 'bad' : undefined, '/admin/sr/incidents')}
          {card(t('سائقون بانتظار المراجعة', 'Drivers to review', 'Chauffeurs à vérifier'), k.driversInReview, k.driversInReview > 0 ? 'warn' : undefined, '/admin/drivers')}
        </div>
      )}
      <div ref={mapBox} style={S.map} />
      {routeInfo && <p style={S.dim}>{routeInfo}</p>}
      <div style={S.list}>
        {ops && ops.rides.length === 0 && <p style={S.dim}>{t('لا توجد رحلات نشطة.', 'No active rides.', 'Aucune course active.')}</p>}
        {ops?.rides.map((r) => (
          <div key={r.id} style={{ ...S.row, ...(r.id === selected ? S.rowOn : {}) }} onClick={() => void pickRide(r)}>
            <div>
              <strong>{r.status}</strong> {r.gpsStale && <span style={S.badBadge}>GPS lost</span>} {!r.prepaid && <span style={S.warnBadge}>unpaid</span>}
              <div style={S.dim}>{r.pickup} → {r.dropoff}</div>
              <div style={S.dim}>{t('الراكب', 'Rider', 'Client')}: {r.rider?.displayName ?? '-'} · {t('السائق', 'Driver', 'Chauffeur')}: {r.driver?.displayName ?? '-'}</div>
            </div>
            <strong>{r.fareMinor != null ? moneyText(r.fareMinor, r.currency, lang) : '-'}</strong>
          </div>
        ))}
      </div>
      <div style={S.links}>
        <button style={S.link} onClick={() => (window.location.hash = '/admin/sr/rides')}>{t('النزاعات والرحلات', 'Rides & disputes', 'Courses et litiges')}</button>
        <button style={S.link} onClick={() => (window.location.hash = '/admin/drivers')}>{t('مراجعة السائقين', 'Driver review', 'Contrôle des chauffeurs')}</button>
        <button style={S.link} onClick={() => (window.location.hash = '/admin/vehicles')}>{t('المركبات', 'Vehicles', 'Véhicules')}</button>
        <button style={S.link} onClick={() => (window.location.hash = '/admin/sr/incidents')}>{t('بلاغات السلامة', 'Safety incidents', 'Incidents')}</button>
      </div>
    </main>
  )
}

const S: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 14, maxWidth: 1100, margin: '0 auto', alignContent: 'start' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  title: { margin: 0, fontSize: 28 },
  err: { color: '#ff8aa0', margin: 0 },
  kpis: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  kpi: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 14 },
  warn: { borderColor: 'rgba(245,197,66,.5)', background: 'rgba(245,197,66,.08)' },
  bad: { borderColor: 'rgba(255,96,96,.6)', background: 'rgba(255,96,96,.1)' },
  kpiValue: { fontSize: 26, fontWeight: 900 },
  kpiLabel: { color: '#9aa6ba', fontSize: 13 },
  map: { height: 380, borderRadius: 8, overflow: 'hidden', border: '1px solid #1e2a3c' },
  dim: { color: '#9aa6ba', fontSize: 13, margin: 0 },
  list: { display: 'grid', gap: 8 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 12, cursor: 'pointer' },
  rowOn: { borderColor: '#19d7ff' },
  badBadge: { background: 'rgba(255,96,96,.2)', color: '#ff8aa0', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 800 },
  warnBadge: { background: 'rgba(245,197,66,.2)', color: '#f5c542', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 800 },
  links: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  link: { minHeight: 40, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 800 },
}

export default AdminOperationsPage
