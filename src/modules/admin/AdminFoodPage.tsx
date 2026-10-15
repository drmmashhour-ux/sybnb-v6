import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchAdminFoodMerchants,
  fetchFoodPhotoQueue,
  foodPhotoSrc,
  reviewFoodPhoto,
  setFoodMerchantStatus,
  type AdminFoodMerchant,
  type FoodPhotoQueueEntry,
} from '../../shared/api/platformApi'

type Props = { lang: Lang }

// SE (Eats) admin console (Menu Studio phase, 2026-10-15). Two fail-closed queues an operator must
// clear before anything goes live:
//   1. Merchant review — a store sells nothing until APPROVED (mirrors vehicle review).
//   2. Photo verification — no photo is customer-visible until APPROVED here. The card shows the
//      server's standards evidence (dimensions, size) and flags photos whose files carry an
//      editing-software signature (Photoshop/GIMP/...) so the reviewer looks twice: SYBNB's photo
//      standard is REAL photos of the actual dish/store, not composited marketing art.

const copy = {
  ar: {
    back: 'لوحة الإدارة',
    title: 'إيتس — المتاجر والصور',
    subtitle: 'لا يُفعّل متجر ولا تظهر صورة للزبائن قبل الاعتماد هنا.',
    loading: 'جار التحميل...',
    merchantsTitle: 'مراجعة المتاجر',
    photosTitle: 'مراجعة الصور',
    emptyMerchants: 'لا توجد متاجر بانتظار المراجعة.',
    emptyPhotos: 'لا توجد صور بانتظار المراجعة.',
    owner: 'المالك',
    cityL: 'المدينة',
    items: 'أصناف',
    orders: 'طلبات',
    approve: 'اعتماد',
    suspend: 'إيقاف',
    approvePhoto: 'اعتماد الصورة',
    rejectPhoto: 'رفض الصورة',
    rejectNoteL: 'سبب الرفض (يظهر للتاجر)',
    noteRequired: 'اكتب سبب الرفض أولًا.',
    cover: 'صورة غلاف',
    dish: 'صورة صنف',
    editorFlag: 'الملف يحمل توقيع برنامج تعديل:',
    noEditorFlag: 'لا يوجد توقيع برنامج تعديل في الملف',
    showAll: 'كل المتاجر',
    showPending: 'بانتظار المراجعة فقط',
    error: 'حدث خطأ',
    saved: 'تم الحفظ',
    statusB: { PENDING_REVIEW: 'قيد المراجعة', APPROVED: 'معتمد', SUSPENDED: 'موقوف' } as Record<string, string>,
  },
  en: {
    back: 'Admin panel',
    title: 'Eats — merchants & photos',
    subtitle: 'No store goes live and no photo reaches customers until approved here.',
    loading: 'Loading...',
    merchantsTitle: 'Merchant review',
    photosTitle: 'Photo verification',
    emptyMerchants: 'No merchants awaiting review.',
    emptyPhotos: 'No photos awaiting review.',
    owner: 'Owner',
    cityL: 'City',
    items: 'items',
    orders: 'orders',
    approve: 'Approve',
    suspend: 'Suspend',
    approvePhoto: 'Approve photo',
    rejectPhoto: 'Reject photo',
    rejectNoteL: 'Rejection reason (shown to the merchant)',
    noteRequired: 'Write the rejection reason first.',
    cover: 'Cover photo',
    dish: 'Menu item photo',
    editorFlag: 'File carries an editing-software signature:',
    noEditorFlag: 'No editing-software signature in the file',
    showAll: 'All merchants',
    showPending: 'Pending only',
    error: 'Something went wrong',
    saved: 'Saved',
    statusB: { PENDING_REVIEW: 'Pending review', APPROVED: 'Approved', SUSPENDED: 'Suspended' } as Record<string, string>,
  },
  fr: {
    back: 'Administration',
    title: 'Eats — magasins & photos',
    subtitle: "Aucun magasin n'est activé et aucune photo n'est visible avant approbation ici.",
    loading: 'Chargement...',
    merchantsTitle: 'Revue des magasins',
    photosTitle: 'Vérification des photos',
    emptyMerchants: 'Aucun magasin en attente.',
    emptyPhotos: 'Aucune photo en attente.',
    owner: 'Propriétaire',
    cityL: 'Ville',
    items: 'articles',
    orders: 'commandes',
    approve: 'Approuver',
    suspend: 'Suspendre',
    approvePhoto: 'Approuver la photo',
    rejectPhoto: 'Rejeter la photo',
    rejectNoteL: 'Motif du rejet (visible par le commerçant)',
    noteRequired: "Écrivez d'abord le motif du rejet.",
    cover: 'Photo de couverture',
    dish: "Photo d'article",
    editorFlag: "Le fichier porte la signature d'un logiciel de retouche :",
    noEditorFlag: 'Aucune signature de logiciel de retouche',
    showAll: 'Tous les magasins',
    showPending: 'En attente seulement',
    error: 'Une erreur est survenue',
    saved: 'Enregistré',
    statusB: { PENDING_REVIEW: 'En revue', APPROVED: 'Approuvé', SUSPENDED: 'Suspendu' } as Record<string, string>,
  },
}

export function AdminFoodPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = copy[lang]
  const [merchants, setMerchants] = useState<AdminFoodMerchant[]>([])
  const [queue, setQueue] = useState<FoodPhotoQueueEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState('')
  const [pendingOnly, setPendingOnly] = useState(true)
  const [notes, setNotes] = useState<Record<string, string>>({})

  useEffect(() => {
    void load(pendingOnly)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOnly])

  async function load(onlyPending: boolean) {
    setStatus('loading')
    setMessage('')
    try {
      const [rows, photoQueue] = await Promise.all([
        fetchAdminFoodMerchants(onlyPending ? 'PENDING_REVIEW' : undefined),
        fetchFoodPhotoQueue(),
      ])
      setMerchants(rows)
      setQueue(photoQueue)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function decideMerchant(id: string, next: 'APPROVED' | 'SUSPENDED') {
    setBusyId(id)
    setMessage('')
    try {
      await setFoodMerchantStatus(id, next)
      await load(pendingOnly)
      setMessage(t.saved)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setBusyId('')
    }
  }

  async function decidePhoto(entry: FoodPhotoQueueEntry, decision: 'APPROVE' | 'REJECT') {
    const key = `${entry.kind}:${entry.id}`
    const note = (notes[key] || '').trim()
    if (decision === 'REJECT' && !note) {
      setMessage(t.noteRequired)
      return
    }
    setBusyId(key)
    setMessage('')
    try {
      await reviewFoodPhoto(entry.kind, entry.id, decision, note || undefined)
      setQueue((prev) => prev.filter((row) => !(row.kind === entry.kind && row.id === entry.id)))
      setMessage(t.saved)
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
      {message && status !== 'error' && <p style={styles.notice}>{message}</p>}

      {status !== 'loading' ? (
        <>
          <section style={styles.section}>
            <div style={styles.sectionHead}>
              <h2 style={styles.h2}>{t.merchantsTitle}</h2>
              <button style={styles.secondaryButton} onClick={() => setPendingOnly((v) => !v)}>
                {pendingOnly ? t.showAll : t.showPending}
              </button>
            </div>
            {merchants.length === 0 && <p style={styles.dim}>{t.emptyMerchants}</p>}
            <div style={styles.grid}>
              {merchants.map((m) => (
                <article key={m.id} style={styles.card}>
                  <div style={styles.cardHead}>
                    <strong dir="auto">{m.name}</strong>
                    <span style={m.status === 'APPROVED' ? styles.tagOk : m.status === 'SUSPENDED' ? styles.tagBad : styles.tag}>
                      {t.statusB[m.status] || m.status}
                    </span>
                  </div>
                  {m.nameAr ? <span style={styles.dim} dir="rtl">{m.nameAr}</span> : null}
                  <span style={styles.dim}>{t.cityL}: {m.city} · {m.category}</span>
                  <span style={styles.dim} dir="auto">{m.address}</span>
                  <span style={styles.dim} dir="ltr">{t.owner}: {m.ownerEmail || m.ownerName || '—'}</span>
                  <span style={styles.dim}>{m.menuItemCount} {t.items} · {m.orderCount} {t.orders}</span>
                  <div style={styles.actions}>
                    {m.status !== 'APPROVED' ? (
                      <button style={styles.primaryButton} disabled={busyId === m.id} onClick={() => void decideMerchant(m.id, 'APPROVED')}>
                        {t.approve}
                      </button>
                    ) : null}
                    {m.status !== 'SUSPENDED' ? (
                      <button style={styles.rejectButton} disabled={busyId === m.id} onClick={() => void decideMerchant(m.id, 'SUSPENDED')}>
                        {t.suspend}
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>{t.photosTitle}</h2>
            {queue.length === 0 && <p style={styles.dim}>{t.emptyPhotos}</p>}
            <div style={styles.grid}>
              {queue.map((entry) => {
                const key = `${entry.kind}:${entry.id}`
                const meta = entry.photoMeta || {}
                return (
                  <article key={key} style={styles.card}>
                    <div style={styles.cardHead}>
                      <strong dir="auto">{entry.merchantName}</strong>
                      <span style={styles.tag}>{entry.kind === 'merchant' ? t.cover : t.dish}</span>
                    </div>
                    {entry.itemName ? <span style={styles.dim} dir="auto">{entry.itemName}</span> : null}
                    {foodPhotoSrc(entry.photoUrl) ? (
                      <img src={foodPhotoSrc(entry.photoUrl) || undefined} alt="" style={styles.photo} />
                    ) : null}
                    <span style={styles.dim} dir="ltr">
                      {meta.width && meta.height ? `${meta.width}×${meta.height}px` : ''}
                      {meta.bytes ? ` · ${Math.round(meta.bytes / 1024)}KB` : ''}
                      {meta.format ? ` · ${meta.format.replace('image/', '').toUpperCase()}` : ''}
                    </span>
                    {meta.editorSignature ? (
                      <span style={styles.warn}>⚠ {t.editorFlag} {meta.editorSignature}</span>
                    ) : (
                      <span style={styles.okLine}>✓ {t.noEditorFlag}</span>
                    )}
                    <input
                      style={styles.noteInput}
                      dir="auto"
                      placeholder={t.rejectNoteL}
                      value={notes[key] || ''}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                    <div style={styles.actions}>
                      <button style={styles.primaryButton} disabled={busyId === key} onClick={() => void decidePhoto(entry, 'APPROVE')}>
                        {t.approvePhoto}
                      </button>
                      <button style={styles.rejectButton} disabled={busyId === key} onClick={() => void decidePhoto(entry, 'REJECT')}>
                        {t.rejectPhoto}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        </>
      ) : null}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1000, margin: '0 auto', alignContent: 'start' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  title: { margin: 0, fontSize: 28 },
  subtitle: { color: '#9aa6ba', margin: 0 },
  section: { display: 'grid', gap: 10 },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  h2: { margin: 0, fontSize: 19 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 8, alignContent: 'start' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  dim: { color: '#9aa6ba', fontSize: 13 },
  warn: { color: '#ffd27a', fontSize: 13, fontWeight: 800 },
  okLine: { color: '#20d29b', fontSize: 13 },
  tag: { borderRadius: 999, background: 'rgba(25,215,255,.14)', border: '1px solid rgba(25,215,255,.4)', color: '#19d7ff', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  tagOk: { borderRadius: 999, background: 'rgba(32,210,155,.14)', border: '1px solid rgba(32,210,155,.4)', color: '#20d29b', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  tagBad: { borderRadius: 999, background: 'rgba(255,96,96,.12)', border: '1px solid rgba(255,96,96,.4)', color: '#ff8aa0', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  photo: { width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, border: '1px solid #1e2a3c' },
  noteInput: { minHeight: 40, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' },
  primaryButton: { minHeight: 40, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', padding: '0 14px', fontWeight: 950 },
  secondaryButton: { minHeight: 40, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 12px', fontWeight: 800 },
  rejectButton: { minHeight: 40, border: '1px solid rgba(255,96,96,.5)', borderRadius: 8, background: 'rgba(255,96,96,.12)', color: '#ff8aa0', padding: '0 14px', fontWeight: 900 },
  notice: { color: '#20d29b', margin: 0 },
  error: { color: '#ff8aa0', margin: 0 },
}

export default AdminFoodPage
