import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  activateHostAccount,
  fetchHostVerification,
  resubmitHostListing,
  type HostOnboarding,
  type HostOnboardingFeedback,
  type HostVerificationStatus,
} from '../../shared/api/platformApi'

// New-host onboarding tracker (owner decision 2026-10-09). The activation code now comes at the END:
//   ① add your listing  ② review: automatic check + SYBNB team  ③ activation code by email  ④ live.
// The step comes from GET /api/host/verification (server/lib/host-verification.mjs
// hostOnboardingProgress). The 6-digit input appears ONLY at step ③ once a code has been issued.
// A listing sent back for fixes shows the team's note + the issues to fix, with an inline
// "fix and resubmit" form. Visibility/bookability is enforced by the server, not by this card.
// Renders nothing for a verified host unless `showVerified` is set; shows the success state right
// after a successful activation.

type Props = {
  lang: Lang
  showVerified?: boolean
  onVerified?: () => void
  // For screenshots/tests: start from a known status instead of fetching.
  initialStatus?: HostVerificationStatus
}

const LISTING_WIZARD_PATH = '/sell/listing-wizard'

function formatDate(value: string | null, lang: Lang) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(pick(lang, 'ar-SY', 'en-GB', 'fr-CA'), { day: 'numeric', month: 'short', year: 'numeric' })
}

function errorMessage(error: unknown, lang: Lang) {
  const e = error as { code?: string; message?: string; attemptsRemaining?: number } | null
  switch (e?.code) {
    case 'ACTIVATION_CODE_FORMAT':
      return pick(lang, 'أدخل رمز التفعيل المكوّن من 6 أرقام.', 'Enter the 6-digit activation code.', 'Saisissez le code d’activation à 6 chiffres.')
    case 'ACTIVATION_CODE_INVALID':
      return pick(lang, 'الرمز غير صحيح. تحقق منه وحاول مرة أخرى.', 'That code is not correct. Check it and try again.', 'Ce code est incorrect. Vérifiez-le et réessayez.')
    case 'ACTIVATION_CODE_LOCKED':
      return pick(lang, 'تم إيقاف هذا الرمز بعد 5 محاولات خاطئة. اطلب رمزاً جديداً من فريق SYBNB.', 'This code is locked after 5 wrong attempts. Ask the SYBNB team for a new code.', 'Ce code est bloqué après 5 essais erronés. Demandez un nouveau code à l’équipe SYBNB.')
    case 'ACTIVATION_CODE_EXPIRED':
      return pick(lang, 'انتهت صلاحية هذا الرمز. اطلب رمزاً جديداً من فريق SYBNB.', 'This code has expired. Ask the SYBNB team for a new one.', 'Ce code a expiré. Demandez-en un nouveau à l’équipe SYBNB.')
    case 'ACTIVATION_CODE_NOT_FOUND':
      return pick(lang, 'لا يوجد رمز تفعيل لحسابك بعد. سيصلك بالبريد عند الموافقة على إعلانك.', 'There is no activation code for your account yet. It is emailed when your listing is approved.', 'Aucun code d’activation pour l’instant. Il vous est envoyé par e-mail à l’approbation de votre annonce.')
    case 'RATE_LIMITED':
      return pick(lang, 'محاولات كثيرة. انتظر بضع دقائق ثم حاول.', 'Too many attempts. Wait a few minutes and try again.', 'Trop d’essais. Patientez quelques minutes puis réessayez.')
    default:
      return e?.message || pick(lang, 'تعذّر التفعيل. حاول مرة أخرى.', 'Could not activate. Please try again.', 'Activation impossible. Veuillez réessayer.')
  }
}

// Fallback when talking to a server without the onboarding block.
function onboardingOf(status: HostVerificationStatus): HostOnboarding {
  if (status.onboarding) return status.onboarding
  const step = status.verified ? 4 : status.hasPendingCode || status.codeLocked ? 3 : 1
  return { step, needsFixes: false, codeExpectedSoon: false, counts: { total: 0, draft: 0, pending: 0, approved: 0, rejected: 0 }, feedback: [] }
}

function stepLabels(lang: Lang) {
  return [
    { title: pick(lang, 'أضف إعلانك', 'Add your listing', 'Ajoutez votre annonce'), hint: pick(lang, 'الصور والسعر والموقع وصورة الهوية', 'Photos, price, location and ID photo', 'Photos, prix, emplacement et pièce d’identité') },
    { title: pick(lang, 'المراجعة', 'Review', 'Vérification'), hint: pick(lang, 'الإعلان + صورة الهوية: فحص آلي + فريق SYBNB', 'Listing + ID photo: automatic check + SYBNB team', 'Annonce + pièce d’identité : contrôle automatique + équipe SYBNB') },
    { title: pick(lang, 'رمز التفعيل بالبريد', 'Activation code by email', 'Code d’activation par e-mail'), hint: pick(lang, 'يصلك عند الموافقة', 'Sent when approved', 'Envoyé à l’approbation') },
    { title: pick(lang, 'إعلانك ظاهر للضيوف', 'Your listing is live for guests', 'Votre annonce est visible'), hint: pick(lang, 'جاهز للحجز', 'Ready to be booked', 'Prête à être réservée') },
  ]
}

export function HostVerificationCard({ lang, showVerified = false, onVerified, initialStatus }: Props) {
  const isAr = lang === 'ar'
  const [status, setStatus] = useState<HostVerificationStatus | null>(initialStatus || null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [justVerified, setJustVerified] = useState(false)

  function load() {
    return fetchHostVerification()
      .then((next) => setStatus(next))
      .catch(() => {
        /* not signed in as a host yet, or offline: show nothing rather than a broken card */
      })
  }

  useEffect(() => {
    if (initialStatus) return
    let alive = true
    fetchHostVerification()
      .then((next) => {
        if (alive) setStatus(next)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [initialStatus])

  async function activate() {
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 6) {
      setError(errorMessage({ code: 'ACTIVATION_CODE_FORMAT' }, lang))
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await activateHostAccount(digits)
      setStatus((current) => ({ ...(current as HostVerificationStatus), verified: true, verifiedAt: result.verifiedAt, hasPendingCode: false, codeLocked: false }))
      setJustVerified(true)
      onVerified?.()
    } catch (err) {
      setError(errorMessage(err, lang))
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null

  if (status.verified) {
    if (!justVerified && !showVerified) return null
    return (
      <section dir={isAr ? 'rtl' : 'ltr'} style={{ ...styles.card, ...styles.cardOk }} role="status" aria-live="polite">
        <strong style={styles.okTitle}>{pick(lang, 'تم التحقق ✓', 'Verified ✓', 'Vérifié ✓')}</strong>
        <p style={styles.body}>
          {pick(
            lang,
            'حسابك كمضيف موثّق. تظهر إعلاناتك المعتمدة للضيوف ويمكن حجزها.',
            'Your host account is verified. Your approved listings are shown to guests and can be booked.',
            'Votre compte hôte est vérifié. Vos annonces approuvées sont visibles et réservables.',
          )}
        </p>
      </section>
    )
  }

  const onboarding = onboardingOf(status)
  const current = onboarding.step
  const labels = stepLabels(lang)

  return (
    <section dir={isAr ? 'rtl' : 'ltr'} style={styles.card} aria-labelledby="host-onboarding-title">
      <div style={styles.headRow}>
        <strong id="host-onboarding-title" style={styles.title}>
          {pick(lang, 'خطوات تفعيل حسابك كمضيف', 'Your path to hosting', 'Votre parcours d’hôte')}
        </strong>
        <span style={styles.stepCount}>
          {pick(lang, `الخطوة ${current} من 4`, `Step ${current} of 4`, `Étape ${current} sur 4`)}
        </span>
      </div>

      <ol style={styles.track} aria-label={pick(lang, 'مراحل التفعيل', 'Onboarding steps', 'Étapes')}>
        {labels.map((label, index) => {
          const n = index + 1
          const state = n < current ? 'done' : n === current ? (n === 2 && onboarding.needsFixes ? 'attention' : 'current') : 'todo'
          return (
            <li key={label.title} style={{ ...styles.trackItem, ...(state === 'current' ? styles.trackItemCurrent : state === 'attention' ? styles.trackItemAttention : {}) }} aria-current={state === 'current' || state === 'attention' ? 'step' : undefined}>
              <span style={{ ...styles.dot, ...(state === 'done' ? styles.dotDone : state === 'current' ? styles.dotCurrent : state === 'attention' ? styles.dotAttention : {}) }} aria-hidden="true">
                {state === 'done' ? '✓' : n}
              </span>
              <span style={styles.trackText}>
                <strong style={{ ...styles.trackTitle, ...(state === 'todo' ? styles.muted : {}) }}>{label.title}</strong>
                <small style={styles.trackHint}>{label.hint}</small>
              </span>
            </li>
          )
        })}
      </ol>

      {current === 1 && (
        <div style={styles.panel}>
          <p style={styles.body}>
            {pick(
              lang,
              'ابدأ بإضافة إعلانك: الصور والسعر والموقع وصورة هويتك. بعد الإرسال نراجع الإعلان + صورة الهوية ونرسل لك رمز التفعيل بالبريد عند الموافقة.',
              'Start by adding your listing: photos, price, location and a photo of your ID. Once you submit it we review the listing + ID photo and email you your activation code when it is approved.',
              'Commencez par ajouter votre annonce : photos, prix, emplacement et une photo de votre pièce d’identité. Après l’envoi, nous vérifions l’annonce + la pièce d’identité et vous envoyons votre code d’activation par e-mail à l’approbation.',
            )}
          </p>
          <button style={styles.button} onClick={() => (window.location.hash = LISTING_WIZARD_PATH)}>
            {pick(lang, 'أضف إعلانك', 'Add your listing', 'Ajouter mon annonce')}
          </button>
        </div>
      )}

      {current === 2 && !onboarding.needsFixes && (
        <div style={styles.panel}>
          <p style={styles.body}>
            {pick(
              lang,
              'قيد المراجعة: الإعلان + صورة الهوية. فحص آلي للصور والعنوان والسعر، ثم يراجع فريق SYBNB هويتك وإعلانك. عند الموافقة نرسل رمز التفعيل إلى بريدك.',
              'In review: your listing + ID photo. An automatic check of photos, address and price, then the SYBNB team reviews your ID and listing. When approved we email you your activation code.',
              'En cours de vérification : l’annonce + la pièce d’identité. Contrôle automatique des photos, de l’adresse et du prix, puis l’équipe SYBNB vérifie votre pièce d’identité et votre annonce. À l’approbation, nous vous envoyons votre code par e-mail.',
            )}
          </p>
        </div>
      )}

      {current === 2 && onboarding.needsFixes && (
        <div style={styles.panel}>
          <p style={{ ...styles.body, ...styles.attentionText }}>
            {pick(
              lang,
              'أعدنا إعلانك لإجراء بعض التعديلات. صحّح النقاط التالية ثم أعد إرساله للمراجعة.',
              'We sent your listing back for a few fixes. Correct the points below, then resubmit it for review.',
              'Nous vous avons renvoyé votre annonce pour quelques corrections. Corrigez les points ci-dessous puis renvoyez-la.',
            )}
          </p>
          {onboarding.feedback.map((item) => (
            <FeedbackItem key={item.listingId} item={item} lang={lang} onResubmitted={() => void load()} />
          ))}
        </div>
      )}

      {current === 3 && (
        <div style={styles.panel}>
          {status.hasPendingCode ? (
            <>
              <p style={styles.codeLead}>{pick(lang, 'أرسلنا رمز التفعيل إلى بريدك — أدخله هنا', 'We emailed you your activation code — enter it here', 'Nous vous avons envoyé votre code d’activation par e-mail — saisissez-le ici')}</p>
              {status.codeExpiresAt && (
                <p style={styles.hint}>
                  {pick(lang, 'الرمز صالح حتى', 'The code is valid until', 'Le code est valable jusqu’au')} {formatDate(status.codeExpiresAt, lang)}
                </p>
              )}
              <div style={styles.row}>
                <label style={styles.srOnly} htmlFor="host-activation-code">
                  {pick(lang, 'رمز التفعيل', 'Activation code', 'Code d’activation')}
                </label>
                <input
                  id="host-activation-code"
                  style={styles.input}
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="••••••"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value)
                    setError('')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void activate()
                  }}
                />
                <button style={{ ...styles.button, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={() => void activate()}>
                  {busy ? '…' : pick(lang, 'تفعيل', 'Activate', 'Activer')}
                </button>
              </div>
              {error && (
                <p role="alert" style={styles.error}>
                  {error}
                </p>
              )}
            </>
          ) : status.codeLocked ? (
            <p style={{ ...styles.body, ...styles.attentionText }}>{errorMessage({ code: 'ACTIVATION_CODE_LOCKED' }, lang)}</p>
          ) : (
            <p style={styles.body}>
              {pick(
                lang,
                'تمت الموافقة على إعلانك. رمز التفعيل في طريقه إلى بريدك؛ إن لم يصلك أو انتهت صلاحيته تواصل مع فريق SYBNB.',
                'Your listing is approved. Your activation code is on its way to your email; if it did not arrive or has expired, contact the SYBNB team.',
                'Votre annonce est approuvée. Votre code d’activation arrive par e-mail ; s’il n’arrive pas ou a expiré, contactez l’équipe SYBNB.',
              )}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function FeedbackItem({ item, lang, onResubmitted }: { item: HostOnboardingFeedback; lang: Lang; onResubmitted: () => void }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.titleAr || '')
  const [description, setDescription] = useState(item.description || '')
  // priceMinor is stored as WHOLE units for every currency in this app (SYP and USD alike) — the
  // listing wizard's toMinor() never multiplies, and moneyText() never divides. The earlier cents
  // assumption for USD/EUR/… corrupted USD prices 100x (a $120 listing showed as "1.2", and saving
  // "120" stored 12000 → "$12,000"). Keep this at whole units to match the rest of the pipeline.
  const minorFactor = 1
  const [price, setPrice] = useState(item.priceMinor ? String(item.priceMinor / minorFactor) : '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const listingTitle = pick(lang, item.titleAr, item.titleEn || item.titleAr, item.titleEn || item.titleAr)

  async function resubmit() {
    const changes: { titleAr?: string; description?: string; priceMinor?: number } = {}
    if (title.trim() && title.trim() !== item.titleAr) changes.titleAr = title.trim()
    if (description.trim() !== (item.description || '').trim()) changes.description = description.trim()
    const priceNumber = Math.round(Number(price.replace(/[^\d.]/g, '')) * minorFactor)
    if (Number.isFinite(priceNumber) && priceNumber > 0 && priceNumber !== item.priceMinor) changes.priceMinor = priceNumber
    setSaving(true)
    setMessage('')
    try {
      await resubmitHostListing(item.listingId, changes)
      setEditing(false)
      onResubmitted()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : pick(lang, 'تعذّر الحفظ. حاول مرة أخرى.', 'Could not save. Please try again.', 'Enregistrement impossible. Réessayez.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <article style={styles.feedback}>
      <strong style={styles.feedbackTitle}>{listingTitle}</strong>
      {item.note && (
        <p style={styles.note}>
          <b>{pick(lang, 'ملاحظة فريق SYBNB: ', 'SYBNB team note: ', 'Note de l’équipe SYBNB : ')}</b>
          {item.note}
        </p>
      )}
      {item.issues.length > 0 && (
        <ul style={styles.issues}>
          {item.issues.map((issue) => (
            <li key={issue} dir="auto">{issue}</li>
          ))}
        </ul>
      )}
      {!editing ? (
        <button style={styles.secondary} onClick={() => setEditing(true)}>
          {pick(lang, 'عدّل الإعلان وأعد الإرسال', 'Edit the listing and resubmit', 'Modifier l’annonce et renvoyer')}
        </button>
      ) : (
        <div style={styles.editForm}>
          <label style={styles.label}>
            {pick(lang, 'العنوان', 'Title', 'Titre')}
            <input style={styles.field} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label style={styles.label}>
            {pick(lang, 'الوصف', 'Description', 'Description')}
            <textarea style={{ ...styles.field, minHeight: 90 }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label style={styles.label}>
            {pick(lang, `السعر لليلة (${item.currency})`, `Price per night (${item.currency})`, `Prix par nuit (${item.currency})`)}
            <input style={styles.field} dir="ltr" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <small style={styles.trackHint}>
            {pick(
              lang,
              'لتغيير الصور، أضف إعلاناً جديداً بالصور الصحيحة أو تواصل مع فريق SYBNB.',
              'To change photos, add a new listing with the right photos or contact the SYBNB team.',
              'Pour changer les photos, ajoutez une nouvelle annonce ou contactez l’équipe SYBNB.',
            )}
          </small>
          <div style={styles.editActions}>
            <button style={{ ...styles.button, opacity: saving ? 0.7 : 1 }} disabled={saving} onClick={() => void resubmit()}>
              {saving ? '…' : pick(lang, 'حفظ وإعادة الإرسال للمراجعة', 'Save and resubmit for review', 'Enregistrer et renvoyer')}
            </button>
            <button style={styles.secondary} disabled={saving} onClick={() => setEditing(false)}>
              {pick(lang, 'إلغاء', 'Cancel', 'Annuler')}
            </button>
          </div>
          {message && <p role="alert" style={styles.error}>{message}</p>}
        </div>
      )}
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  card: { border: '1px solid #262b3d', borderRadius: 14, background: '#0e1019', padding: 18, display: 'grid', gap: 14, color: '#fff', minWidth: 0 },
  cardOk: { border: '1px solid rgba(32,210,155,.45)', background: 'rgba(32,210,155,.08)' },
  headRow: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: 18, lineHeight: 1.5, fontWeight: 900 },
  stepCount: { color: '#9fb0ff', fontWeight: 800, fontSize: 13 },
  okTitle: { fontSize: 18, color: '#20d29b', fontWeight: 950 },
  track: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 },
  trackItem: { display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr)', gap: 10, alignItems: 'start', border: '1px solid #20263a', borderRadius: 12, padding: '10px 12px', background: '#0b0d15', minWidth: 0 },
  trackItemCurrent: { border: '1px solid #5268ff', background: 'rgba(82,104,255,.10)' },
  trackItemAttention: { border: '1px solid rgba(229,184,11,.6)', background: 'rgba(229,184,11,.08)' },
  dot: { width: 30, height: 30, borderRadius: 999, display: 'grid', placeItems: 'center', fontWeight: 950, fontSize: 14, background: '#1a1f2e', color: '#8e98ad' },
  dotDone: { background: '#20d29b', color: '#06281e' },
  dotCurrent: { background: '#5268ff', color: '#fff' },
  dotAttention: { background: '#e5b80b', color: '#14110a' },
  trackText: { display: 'grid', gap: 2, minWidth: 0 },
  trackTitle: { fontSize: 14.5, lineHeight: 1.4, fontWeight: 900 },
  trackHint: { color: '#8e98ad', fontSize: 12.5, lineHeight: 1.5 },
  muted: { color: '#aab3c8' },
  panel: { display: 'grid', gap: 10, borderTop: '1px solid #1d2233', paddingTop: 12 },
  body: { margin: 0, color: '#c3cad8', lineHeight: 1.7 },
  attentionText: { color: '#f1d26a' },
  codeLead: { margin: 0, color: '#fff', fontWeight: 900, fontSize: 16.5, lineHeight: 1.6 },
  hint: { margin: 0, color: '#e5b80b', fontWeight: 800, fontSize: 14 },
  row: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, maxWidth: 420 },
  input: { minHeight: 50, minWidth: 0, border: '1px solid #3a4157', borderRadius: 10, background: '#0b0f1a', color: '#fff', padding: '0 14px', fontSize: 22, letterSpacing: 6, textAlign: 'center', fontWeight: 900, fontFamily: 'inherit' },
  button: { minHeight: 48, border: 0, borderRadius: 10, background: '#5268ff', color: '#fff', fontWeight: 950, fontSize: 15.5, padding: '0 20px', cursor: 'pointer', justifySelf: 'start' },
  secondary: { minHeight: 42, border: '1px solid #30384d', borderRadius: 10, background: '#151a28', color: '#fff', fontWeight: 900, cursor: 'pointer', padding: '0 14px', justifySelf: 'start' },
  error: { margin: 0, color: '#ff9aac', fontWeight: 800 },
  feedback: { display: 'grid', gap: 8, border: '1px solid rgba(229,184,11,.35)', borderRadius: 12, padding: 12, background: 'rgba(229,184,11,.05)' },
  feedbackTitle: { fontSize: 15 },
  note: { margin: 0, color: '#dfe4ee', lineHeight: 1.6 },
  issues: { margin: 0, paddingInlineStart: 20, color: '#dfe4ee', lineHeight: 1.7, display: 'grid', gap: 2 },
  editForm: { display: 'grid', gap: 10 },
  label: { display: 'grid', gap: 6, fontWeight: 800, fontSize: 13.5, color: '#c3cad8' },
  field: { minHeight: 44, border: '1px solid #3a4157', borderRadius: 10, background: '#0b0f1a', color: '#fff', padding: '8px 12px', fontSize: 15, fontFamily: 'inherit', minWidth: 0 },
  editActions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
}
