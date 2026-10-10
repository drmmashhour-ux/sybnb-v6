import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchAdminDriverVehicles,
  reviewAdminDriverVehicle,
  type PlatformDriverVehicle,
} from '../../shared/api/platformApi'

type Props = { lang: Lang }

// Launch blocker #188 (2026-10-10): the operator screen that clears a driver's vehicle to carry
// passengers. A self-declared vehicle sits in PENDING_REVIEW; the claim/assign gates refuse any
// ride until vehicleStatus === 'APPROVED'. This page lists the pending queue and lets an operator
// approve/reject the vehicle and record the mechanical-inspection outcome (PASSED/FAILED + expiry).

const copy = {
  ar: {
    back: 'لوحة الإدارة',
    title: 'مراجعة المركبات — سير',
    subtitle: 'المركبات بانتظار الموافقة. لا يمكن لأي سائق حمل راكب قبل اعتماد مركبته.',
    loading: 'جار التحميل...',
    error: 'تعذر تحميل المركبات',
    empty: 'لا توجد مركبات بانتظار المراجعة.',
    driver: 'السائق',
    vehicle: 'المركبة',
    plate: 'اللوحة',
    year: 'سنة الصنع',
    color: 'اللون',
    category: 'الفئة',
    registration: 'انتهاء التسجيل',
    inspection: 'الفحص الميكانيكي',
    idDoc: 'حالة الهوية',
    approve: 'اعتماد المركبة',
    reject: 'رفض',
    inspectionLabel: 'نتيجة الفحص',
    inspectionExpiry: 'انتهاء الفحص (اختياري)',
    saveInspection: 'حفظ الفحص',
    pending: 'قيد الانتظار',
    passed: 'ناجح',
    failed: 'راسب',
    expired: 'منتهٍ',
    none: '—',
    expiredWarn: 'التسجيل منتهٍ',
    tooOld: 'المركبة أقدم من حد الفئة',
    saved: 'تم الحفظ',
  },
  en: {
    back: 'Admin panel',
    title: 'Vehicle review — SR Ride',
    subtitle: 'Vehicles awaiting approval. No driver can carry a passenger until their vehicle is approved.',
    loading: 'Loading...',
    error: 'Could not load vehicles',
    empty: 'No vehicles awaiting review.',
    driver: 'Driver',
    vehicle: 'Vehicle',
    plate: 'Plate',
    year: 'Year',
    color: 'Color',
    category: 'Category',
    registration: 'Registration expires',
    inspection: 'Mechanical inspection',
    idDoc: 'ID status',
    approve: 'Approve vehicle',
    reject: 'Reject',
    inspectionLabel: 'Inspection result',
    inspectionExpiry: 'Inspection expiry (optional)',
    saveInspection: 'Save inspection',
    pending: 'Pending',
    passed: 'Passed',
    failed: 'Failed',
    expired: 'Expired',
    none: '—',
    expiredWarn: 'Registration expired',
    tooOld: 'Vehicle older than category limit',
    saved: 'Saved',
  },
  fr: {
    back: 'Administration',
    title: 'Contrôle des véhicules — SR Ride',
    subtitle: 'Véhicules en attente d’approbation. Aucun chauffeur ne peut transporter un passager tant que son véhicule n’est pas approuvé.',
    loading: 'Chargement...',
    error: 'Impossible de charger les véhicules',
    empty: 'Aucun véhicule en attente.',
    driver: 'Chauffeur',
    vehicle: 'Véhicule',
    plate: 'Plaque',
    year: 'Année',
    color: 'Couleur',
    category: 'Catégorie',
    registration: 'Expiration immatriculation',
    inspection: 'Contrôle technique',
    idDoc: 'Statut pièce',
    approve: 'Approuver le véhicule',
    reject: 'Rejeter',
    inspectionLabel: 'Résultat du contrôle',
    inspectionExpiry: 'Expiration du contrôle (facultatif)',
    saveInspection: 'Enregistrer le contrôle',
    pending: 'En attente',
    passed: 'Réussi',
    failed: 'Échoué',
    expired: 'Expiré',
    none: '—',
    expiredWarn: 'Immatriculation expirée',
    tooOld: 'Véhicule plus ancien que la limite de catégorie',
    saved: 'Enregistré',
  },
}

// Mirror of server/lib/vehicle-category.mjs VEHICLE_MAX_AGE_YEARS defaults (display hint only; the
// server is the source of truth and enforces the gate). BIKE = no age limit.
const MAX_AGE_YEARS: Record<string, number | null> = {
  BIKE: null,
  ECONOMY: 20,
  COMFORT: 12,
  SUV: 12,
  VAN: 15,
}

function fmtDate(ts: string | null | undefined) {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

function isExpired(ts: string | null | undefined) {
  if (!ts) return false
  const d = new Date(ts)
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now()
}

function isTooOld(category: string | null, year: number | null) {
  if (!category || year == null) return false
  const maxAge = MAX_AGE_YEARS[category]
  if (maxAge == null) return false
  return year < new Date().getFullYear() - maxAge
}

export function AdminVehiclesPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = copy[lang]
  const [vehicles, setVehicles] = useState<PlatformDriverVehicle[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState('')
  // Per-row inspection form state (status + expiry), keyed by driver userId.
  const [inspForm, setInspForm] = useState<Record<string, { status: string; expiry: string }>>({})

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStatus('loading')
    try {
      setVehicles(await fetchAdminDriverVehicles())
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function decide(driverId: string, decision: 'APPROVE' | 'REJECT') {
    setBusyId(driverId)
    setMessage('')
    try {
      await reviewAdminDriverVehicle(driverId, { decision })
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setBusyId('')
    }
  }

  async function saveInspection(driverId: string) {
    const form = inspForm[driverId]
    if (!form || !form.status) return
    setBusyId(driverId)
    setMessage('')
    try {
      await reviewAdminDriverVehicle(driverId, {
        inspectionStatus: form.status as 'PENDING' | 'PASSED' | 'FAILED' | 'EXPIRED',
        inspectionExpiresAt: form.expiry ? new Date(form.expiry).toISOString() : null,
      })
      setMessage(t.saved)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setBusyId('')
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/admin/review')}>
        ← {t.back}
      </button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      {status === 'loading' && <p>{t.loading}</p>}
      {status === 'error' && <p style={styles.error}>{message}</p>}
      {status === 'ready' && vehicles.length === 0 && <p>{t.empty}</p>}
      {message && status !== 'error' && <p style={styles.notice}>{message}</p>}

      <div style={styles.grid}>
        {vehicles.map((v) => {
          const name = v.user?.displayName || v.user?.email || v.userId.slice(0, 8)
          const vehicleParts = [v.vehicleColor, v.vehicleMake, v.vehicleModel, v.vehicleYear]
            .filter((p) => p != null && p !== '')
            .join(' · ')
          const regExpired = isExpired(v.registrationExpiresAt)
          const tooOld = isTooOld(v.vehicleCategory, v.vehicleYear)
          const form = inspForm[v.userId] || { status: v.inspectionStatus || '', expiry: '' }
          return (
            <article key={v.userId} style={styles.card}>
              <div style={styles.cardHead}>
                <strong>{name}</strong>
                <span style={styles.catTag}>{v.vehicleCategory || t.none}</span>
              </div>
              <span dir="ltr" style={styles.dim}>
                {t.vehicle}: {vehicleParts || t.none}
              </span>
              <span dir="ltr">
                {t.plate}: <strong>{v.vehiclePlate || t.none}</strong>
              </span>
              <span dir="ltr" style={regExpired ? styles.warn : styles.dim}>
                {t.registration}: {fmtDate(v.registrationExpiresAt) || t.none}
                {regExpired ? ` ⚠ ${t.expiredWarn}` : ''}
              </span>
              {tooOld && <span style={styles.warn}>⚠ {t.tooOld}</span>}
              <span style={styles.dim}>
                {t.idDoc}: {v.user?.idDocumentStatus || t.none}
              </span>
              <span style={styles.dim}>
                {t.inspection}: {v.inspectionStatus || t.none}
                {v.inspectionExpiresAt ? ` · ${fmtDate(v.inspectionExpiresAt)}` : ''}
              </span>

              <div style={styles.actions}>
                <button
                  style={styles.primaryButton}
                  disabled={busyId === v.userId || !v.vehiclePlate}
                  onClick={() => void decide(v.userId, 'APPROVE')}
                >
                  {t.approve}
                </button>
                <button
                  style={styles.rejectButton}
                  disabled={busyId === v.userId}
                  onClick={() => void decide(v.userId, 'REJECT')}
                >
                  {t.reject}
                </button>
              </div>

              <div style={styles.inspBox}>
                <span style={styles.dim}>{t.inspectionLabel}</span>
                <div style={styles.actions}>
                  <select
                    style={styles.select}
                    value={form.status}
                    onChange={(e) =>
                      setInspForm((prev) => ({ ...prev, [v.userId]: { ...form, status: e.target.value } }))
                    }
                  >
                    <option value="">{t.none}</option>
                    <option value="PENDING">{t.pending}</option>
                    <option value="PASSED">{t.passed}</option>
                    <option value="FAILED">{t.failed}</option>
                    <option value="EXPIRED">{t.expired}</option>
                  </select>
                  <input
                    type="date"
                    style={styles.select}
                    value={form.expiry}
                    aria-label={t.inspectionExpiry}
                    onChange={(e) =>
                      setInspForm((prev) => ({ ...prev, [v.userId]: { ...form, expiry: e.target.value } }))
                    }
                  />
                  <button
                    style={styles.secondaryButton}
                    disabled={busyId === v.userId || !form.status}
                    onClick={() => void saveInspection(v.userId)}
                  >
                    {t.saveInspection}
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1000, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  title: { margin: 0, fontSize: 28 },
  subtitle: { color: '#9aa6ba', margin: 0 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 8 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  dim: { color: '#9aa6ba', fontSize: 13 },
  warn: { color: '#ffd27a', fontSize: 13, fontWeight: 800 },
  catTag: { borderRadius: 999, background: 'rgba(25,215,255,.14)', border: '1px solid rgba(25,215,255,.4)', color: '#19d7ff', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' },
  primaryButton: { minHeight: 40, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', padding: '0 14px', fontWeight: 950 },
  secondaryButton: { minHeight: 40, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 12px', fontWeight: 800 },
  rejectButton: { minHeight: 40, border: '1px solid rgba(255,96,96,.5)', borderRadius: 8, background: 'rgba(255,96,96,.12)', color: '#ff8aa0', padding: '0 14px', fontWeight: 900 },
  inspBox: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#0b111b', padding: 10, display: 'grid', gap: 6, marginTop: 4 },
  select: { minHeight: 40, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
  notice: { color: '#20d29b', margin: 0 },
  error: { color: '#ff8aa0', margin: 0 },
}

export default AdminVehiclesPage
