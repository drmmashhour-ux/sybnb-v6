import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  fetchOpenHouses,
  createOpenHouse,
  cancelOpenHouse,
  getStoredGuestSession,
  type PlatformListing,
  type PlatformOpenHouse,
} from '../../shared/api/platformApi'

// Open houses (Centris-depth, 2026-10-11). Public upcoming list on every listing; owners get an
// inline add/cancel form. Distinct from schedule-a-visit (1:1) — this is a published viewing window.
function fmt(dt: string, lang: Lang): string {
  const d = new Date(dt)
  if (isNaN(d.getTime())) return dt
  const locale = lang === 'ar' ? 'ar' : lang === 'fr' ? 'fr-FR' : 'en-GB'
  return d.toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function OpenHousesPanel({ listing, lang }: { listing: PlatformListing; lang: Lang }) {
  const isAr = lang === 'ar'
  const isOwner = getStoredGuestSession()?.user?.id === listing.ownerId
  const [items, setItems] = useState<PlatformOpenHouse[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = () => {
    fetchOpenHouses(listing.id).then((rows) => { setItems(rows); setLoaded(true) }).catch(() => setLoaded(true))
  }
  useEffect(reload, [listing.id])

  const submit = async () => {
    setError('')
    if (!startsAt || !endsAt) { setError(pick(lang, 'أدخل وقت البداية والنهاية.', 'Enter start and end time.', 'Indiquez le début et la fin.')); return }
    setBusy(true)
    try {
      await createOpenHouse(listing.id, { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), note: note.trim() || undefined })
      setStartsAt(''); setEndsAt(''); setNote(''); setShowForm(false)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : pick(lang, 'تعذّر الحفظ.', 'Could not save.', 'Échec.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try { await cancelOpenHouse(id); reload() } catch { /* noop */ } finally { setBusy(false) }
  }

  // Hide entirely for non-owners when there is nothing to show.
  if (loaded && items.length === 0 && !isOwner) return null

  return (
    <section style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <div style={styles.head}>
        <strong style={styles.title}>🚪 {pick(lang, 'أيام مفتوحة للزيارة', 'Open houses', 'Visites libres')}</strong>
        {isOwner && (
          <button type="button" style={styles.addBtn} onClick={() => setShowForm((v) => !v)}>
            {showForm ? pick(lang, 'إلغاء', 'Close', 'Fermer') : pick(lang, '+ إضافة', '+ Add', '+ Ajouter')}
          </button>
        )}
      </div>

      {items.length > 0 ? (
        <ul style={styles.list}>
          {items.map((oh) => (
            <li key={oh.id} style={styles.item}>
              <div style={{ display: 'grid', gap: 2 }}>
                <span style={styles.when}>🗓️ {fmt(oh.startsAt, lang)} — {fmt(oh.endsAt, lang)}</span>
                {oh.note && <small style={styles.note}>{oh.note}</small>}
              </div>
              {isOwner && (
                <button type="button" style={styles.cancelBtn} disabled={busy} onClick={() => remove(oh.id)}>
                  {pick(lang, 'إلغاء', 'Cancel', 'Annuler')}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        isOwner && !showForm && <p style={styles.empty}>{pick(lang, 'لا توجد أيام زيارة مجدولة بعد.', 'No open houses scheduled yet.', 'Aucune visite libre programmée.')}</p>
      )}

      {isOwner && showForm && (
        <div style={styles.form}>
          <label style={styles.label}>{pick(lang, 'من', 'From', 'Du')}
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>{pick(lang, 'إلى', 'To', 'Au')}
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>{pick(lang, 'ملاحظة (اختياري)', 'Note (optional)', 'Note (optionnel)')}
            <input type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} style={styles.input} placeholder={pick(lang, 'مثال: الطابق الثالث، اسأل عن محمد', 'e.g. 3rd floor, ask for Mohamed', 'ex : 3e étage')} />
          </label>
          {error && <span style={styles.error}>{error}</span>}
          <button type="button" style={styles.saveBtn} disabled={busy} onClick={submit}>
            {busy ? pick(lang, 'جارٍ الحفظ…', 'Saving…', 'Enregistrement…') : pick(lang, 'نشر اليوم المفتوح', 'Publish open house', 'Publier la visite')}
          </button>
        </div>
      )}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 10, marginTop: 16, padding: 16, borderRadius: 16, border: '1px solid #e6e9ee', background: '#fff' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 15 },
  addBtn: { border: '1px solid #0d5c63', background: 'transparent', color: '#0d5c63', borderRadius: 999, padding: '4px 12px', fontSize: 13, cursor: 'pointer' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 },
  item: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderRadius: 12, background: '#f6f7f9' },
  when: { fontSize: 14, fontWeight: 600 },
  note: { color: '#5c6673' },
  empty: { color: '#5c6673', fontSize: 13, margin: 0 },
  cancelBtn: { border: '1px solid #d9b3b3', background: 'transparent', color: '#b23b3b', borderRadius: 999, padding: '3px 10px', fontSize: 12, cursor: 'pointer' },
  form: { display: 'grid', gap: 8, padding: 12, borderRadius: 12, background: '#f6f7f9' },
  label: { display: 'grid', gap: 4, fontSize: 13, color: '#5c6673' },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid #cfd6de', fontSize: 14 },
  error: { color: '#b23b3b', fontSize: 13 },
  saveBtn: { border: 'none', background: '#0d5c63', color: '#fff', borderRadius: 10, padding: '10px 14px', fontSize: 14, cursor: 'pointer' },
}
