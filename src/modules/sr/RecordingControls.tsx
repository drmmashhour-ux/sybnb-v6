import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  attachRecordingReport,
  declineRideRecordingConsent,
  fetchRecordingContext,
  fetchRecordingPreference,
  fetchRideRecordings,
  setRecordingPreference,
  uploadRideRecording,
  type RecordingContext,
  type RecordingMode,
  type RideRecordingMeta,
} from '../../shared/api/platformApi'

type Props = { rideId: string; lang: Lang }

const MODE_LABELS: Record<RecordingMode, { ar: string; en: string; fr: string }> = {
  OFF: { ar: 'إيقاف', en: 'Off', fr: 'Désactivé' },
  ON_DEMAND: { ar: 'عند الطلب', en: 'On demand', fr: 'À la demande' },
  NIGHT_ONLY: { ar: 'الليل فقط', en: 'Night rides only', fr: 'La nuit seulement' },
  EVERY_RIDE: { ar: 'كل رحلة', en: 'Every ride', fr: 'Chaque trajet' },
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)) }
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

function pickMime(): string {
  const MR = (window as unknown as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder
  const cands = ['audio/webm', 'audio/mp4', 'audio/ogg']
  for (const c of cands) { try { if (MR?.isTypeSupported?.(c)) return c } catch { /* noop */ } }
  return 'audio/webm'
}

export function RecordingControls({ rideId, lang }: Props) {
  const isAr = lang === 'ar'
  const [ctx, setCtx] = useState<RecordingContext | null>(null)
  const [mode, setMode] = useState<RecordingMode>('OFF')
  const [captureEnabled, setCaptureEnabled] = useState(false)
  const [recordings, setRecordings] = useState<RideRecordingMeta[]>([])
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mrRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<string>('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function loadAll() {
    const [c, p, recs] = await Promise.all([
      fetchRecordingContext(rideId),
      fetchRecordingPreference().catch(() => null),
      fetchRideRecordings(rideId).catch(() => []),
    ])
    if (c) { setCtx(c); setCaptureEnabled(c.captureEnabled) }
    if (p) { setMode(p.mode); setCaptureEnabled(p.captureEnabled) }
    setRecordings(recs)
  }

  useEffect(() => { void loadAll(); return () => { if (timerRef.current) clearInterval(timerRef.current) } /* eslint-disable-next-line */ }, [rideId])

  async function changeMode(next: RecordingMode) {
    setMode(next)
    try { const r = await setRecordingPreference(next); setCaptureEnabled(r.captureEnabled) }
    catch (e) { if ((e as { code?: string }).code === 'GUEST_SESSION_REQUIRED') window.location.hash = '/account' }
  }

  async function startRecording() {
    setError(null); setNotice(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMime()
      const mr = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunksRef.current.push(ev.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (timerRef.current) clearInterval(timerRef.current)
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setBusy(true)
        try {
          if (blob.size > 8 * 1024 * 1024) { setError(pick(lang, 'التسجيل طويل جداً. سجّل مقطعاً أقصر.', 'Recording too long. Record a shorter clip.', 'Enregistrement trop long.')); return }
          const base64 = await blobToBase64(blob)
          await uploadRideRecording(rideId, { base64, contentType: mimeType, durationSec: elapsed, startedAt: startedAtRef.current })
          setNotice(pick(lang, 'تم حفظ التسجيل بأمان (خاص بك، يُحذف بعد ٧ أيام).', 'Recording saved securely (private to you, deleted after 7 days).', 'Enregistrement sauvegardé (privé, supprimé après 7 jours).'))
          await loadAll()
        } catch (e) {
          setError((e as { message?: string }).message || pick(lang, 'تعذر حفظ التسجيل.', 'Could not save the recording.', 'Échec de la sauvegarde.'))
        } finally { setBusy(false); setElapsed(0) }
      }
      startedAtRef.current = new Date().toISOString()
      mr.start()
      mrRef.current = mr
      setRecording(true); setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000)
    } catch {
      setError(pick(lang, 'تعذر الوصول إلى الميكروفون.', 'Could not access the microphone.', 'Micro inaccessible.'))
    }
  }

  function stopRecording() {
    try { mrRef.current?.stop() } catch { /* noop */ }
    setRecording(false)
  }

  async function report(rec: RideRecordingMeta) {
    setBusy(true)
    try { await attachRecordingReport(rec.id); setNotice(pick(lang, 'أُرفق التسجيل ببلاغ سلامة. يمكن لفريق السلامة الاطّلاع عليه الآن.', 'Recording attached to a safety report. The Safety Team can review it now.', 'Enregistrement joint à un signalement.')); await loadAll() }
    catch (e) { setError((e as { message?: string }).message || 'Error') } finally { setBusy(false) }
  }

  async function declineConsent() {
    if (!window.confirm(pick(lang, 'إلغاء الرحلة بدون رسوم لأنك لا تريد التسجيل؟', 'Cancel the ride (no fee) because you don’t want to be recorded?', 'Annuler sans frais ?'))) return
    setBusy(true)
    try { await declineRideRecordingConsent(rideId); setNotice(pick(lang, 'أُلغيت الرحلة بدون رسوم.', 'Ride cancelled with no fee.', 'Trajet annulé sans frais.')) }
    catch (e) { setError((e as { message?: string }).message || 'Error') } finally { setBusy(false) }
  }

  return (
    <section style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'} aria-label={pick(lang, 'تسجيل الرحلة', 'Ride recording', 'Enregistrement')}>
      <div style={styles.headRow}>
        <strong style={styles.title}>🎙 {pick(lang, 'تسجيل صوتي للسلامة', 'Audio recording for safety', 'Enregistrement audio')}</strong>
      </div>

      {ctx?.counterpartyMayRecord ? (
        <div style={styles.consent}>
          {pick(lang, 'قد يسجّل الطرف الآخر صوت هذه الرحلة للسلامة. التسجيلات خاصة ولا يطّلع عليها إلا فريق السلامة عند الإبلاغ.', 'The other party may record audio on this ride for safety. Recordings are private and only reviewed by the Safety Team if reported.', 'L’autre partie peut enregistrer pour la sécurité.')}
          <button type="button" style={styles.linkBtn} disabled={busy} onClick={declineConsent}>{pick(lang, 'لا أريد التسجيل — إلغاء بدون رسوم', 'Don’t want to be recorded? Cancel (no fee)', 'Annuler sans frais')}</button>
        </div>
      ) : null}

      <label style={styles.field}>
        <span style={styles.muted}>{pick(lang, 'متى يتم التسجيل', 'When to record', 'Quand enregistrer')}</span>
        <select value={mode} onChange={(e) => changeMode(e.target.value as RecordingMode)} dir={isAr ? 'rtl' : 'ltr'} style={styles.select}>
          {(Object.keys(MODE_LABELS) as RecordingMode[]).map((m) => (
            <option key={m} value={m}>{pick(lang, MODE_LABELS[m].ar, MODE_LABELS[m].en, MODE_LABELS[m].fr)}</option>
          ))}
        </select>
      </label>

      {captureEnabled ? (
        !recording ? (
          <button type="button" style={styles.recordBtn} disabled={busy} onClick={startRecording}>● {pick(lang, 'ابدأ التسجيل', 'Start recording', 'Enregistrer')}</button>
        ) : (
          <button type="button" style={{ ...styles.recordBtn, background: '#d14343' }} onClick={stopRecording}>■ {pick(lang, `إيقاف (${elapsed}ث)`, `Stop (${elapsed}s)`, `Arrêter (${elapsed}s)`)}</button>
        )
      ) : (
        <div style={styles.muted}>{pick(lang, 'التسجيل الصوتي سيُفعّل قريباً.', 'Audio capture will be available soon.', 'Bientôt disponible.')}</div>
      )}

      {recordings.length > 0 ? (
        <div style={styles.recList}>
          <span style={styles.muted}>{pick(lang, 'تسجيلاتك لهذه الرحلة', 'Your recordings for this ride', 'Vos enregistrements')}</span>
          {recordings.map((r) => (
            <div key={r.id} style={styles.recRow}>
              <span>🔒 {r.durationSec != null ? `${r.durationSec}s` : '—'} · {pick(lang, 'خاص', 'private', 'privé')}</span>
              {r.attachedIncidentId
                ? <span style={{ color: '#a06a00', fontSize: 12 }}>{pick(lang, 'مُرفق ببلاغ', 'attached to report', 'signalé')}</span>
                : <button type="button" style={styles.reportBtn} disabled={busy} onClick={() => report(r)}>{pick(lang, 'إبلاغ سلامة', 'Report to Safety', 'Signaler')}</button>}
            </div>
          ))}
        </div>
      ) : null}

      <small style={styles.disclaimer}>{pick(lang, 'التسجيلات مشفّرة، خاصة بك، تُحذف تلقائياً بعد ٧ أيام، ولا يصل إليها فريق السلامة إلا إذا أرفقتها ببلاغ.', 'Recordings are encrypted, private to you, auto-deleted after 7 days, and only reachable by the Safety Team if you attach them to a report.', 'Chiffré, privé, supprimé après 7 jours.')}</small>
      {notice ? <div style={styles.notice}>{notice}</div> : null}
      {error ? <div style={styles.error}>{error}</div> : null}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { border: '1px solid #e4e9f2', borderRadius: 16, padding: 16, background: '#fbfcff', display: 'grid', gap: 10, marginTop: 16 },
  headRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 15, color: '#0b1b3b' },
  muted: { color: '#64748b', fontSize: 13 },
  consent: { background: '#fff7e6', border: '1px solid #ffe2a8', borderRadius: 10, padding: 10, fontSize: 13, color: '#7a5600', display: 'grid', gap: 8 },
  field: { display: 'grid', gap: 6 },
  select: { padding: '10px 12px', borderRadius: 10, border: '1px solid #c9d3e6', fontSize: 15, fontFamily: 'inherit' },
  recordBtn: { padding: '12px 16px', borderRadius: 10, border: 'none', background: '#7a1fa2', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 15 },
  recList: { display: 'grid', gap: 6, borderTop: '1px solid #eef1f7', paddingTop: 8 },
  recRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: '#334155' },
  reportBtn: { padding: '6px 10px', borderRadius: 8, border: '1px solid #c9d3e6', background: '#fff', color: '#0b1b3b', fontWeight: 600, cursor: 'pointer', fontSize: 12 },
  linkBtn: { background: 'none', border: 'none', color: '#d14343', cursor: 'pointer', fontSize: 13, padding: 0, justifySelf: 'start' as CSSProperties['justifySelf'], fontWeight: 600 },
  disclaimer: { color: '#94a3b8', fontSize: 11 },
  notice: { color: '#1e9e62', fontSize: 13, fontWeight: 600 },
  error: { color: '#d14343', fontSize: 13, fontWeight: 600 },
}
