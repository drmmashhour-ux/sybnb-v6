import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { activateHostAccount, fetchHostVerification, type HostVerificationStatus } from '../../shared/api/platformApi'

// Host verification step (owner decision 2026-10-08, like Booking.com's partner PIN). Until the host
// enters the 6-digit activation code the SYBNB team gives them, their stays are not shown to guests
// and cannot be booked (enforced by the server, not by this card). Renders nothing for a verified
// host unless `showVerified` is set; shows the success state right after a successful activation.

type Props = {
  lang: Lang
  showVerified?: boolean
  onVerified?: () => void
  // For screenshots/tests: start from a known status instead of fetching.
  initialStatus?: HostVerificationStatus
}

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
      return pick(lang, 'لا يوجد رمز تفعيل لحسابك بعد. سيتواصل معك فريق SYBNB.', 'There is no activation code for your account yet. The SYBNB team will contact you.', 'Aucun code d’activation pour votre compte pour l’instant. L’équipe SYBNB vous contactera.')
    case 'RATE_LIMITED':
      return pick(lang, 'محاولات كثيرة. انتظر بضع دقائق ثم حاول.', 'Too many attempts. Wait a few minutes and try again.', 'Trop d’essais. Patientez quelques minutes puis réessayez.')
    default:
      return e?.message || pick(lang, 'تعذّر التفعيل. حاول مرة أخرى.', 'Could not activate. Please try again.', 'Activation impossible. Veuillez réessayer.')
  }
}

export function HostVerificationCard({ lang, showVerified = false, onVerified, initialStatus }: Props) {
  const isAr = lang === 'ar'
  const [status, setStatus] = useState<HostVerificationStatus | null>(initialStatus || null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [justVerified, setJustVerified] = useState(false)

  useEffect(() => {
    if (initialStatus) return
    let alive = true
    fetchHostVerification()
      .then((next) => {
        if (alive) setStatus(next)
      })
      .catch(() => {
        /* not signed in as a host yet, or offline: show nothing rather than a broken card */
      })
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

  return (
    <section dir={isAr ? 'rtl' : 'ltr'} style={styles.card} aria-labelledby="host-verification-title">
      <div style={styles.head}>
        <span style={styles.badge} aria-hidden="true">●</span>
        <strong id="host-verification-title" style={styles.title}>
          {pick(
            lang,
            'حسابك بانتظار التحقق — سيتواصل معك فريق SYBNB ويعطيك رمز تفعيل من 6 أرقام',
            'Your account is awaiting verification — the SYBNB team will contact you and give you a 6-digit activation code',
            'Votre compte est en attente de vérification — l’équipe SYBNB vous contactera et vous donnera un code d’activation à 6 chiffres',
          )}
        </strong>
      </div>
      <p style={styles.body}>
        {pick(
          lang,
          'إلى أن تُدخل الرمز، لا تظهر إعلاناتك للضيوف ولا يمكن حجزها. يمكنك تجهيز ملفك وإعلانك الآن.',
          'Until you enter the code, your listings are not shown to guests and cannot be booked. You can prepare your profile and listing now.',
          'Tant que vous n’avez pas saisi le code, vos annonces ne sont pas visibles et ne peuvent pas être réservées. Vous pouvez préparer votre profil et votre annonce dès maintenant.',
        )}
      </p>
      {status.hasPendingCode && status.codeExpiresAt && (
        <p style={styles.hint}>
          {pick(lang, 'أُرسل لك رمز صالح حتى', 'A code was issued for you, valid until', 'Un code vous a été attribué, valable jusqu’au')} {formatDate(status.codeExpiresAt, lang)}
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
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  card: { border: '1px solid rgba(229,184,11,.45)', borderRadius: 14, background: 'rgba(229,184,11,.07)', padding: 18, display: 'grid', gap: 10, color: '#fff', minWidth: 0 },
  cardOk: { border: '1px solid rgba(32,210,155,.45)', background: 'rgba(32,210,155,.08)' },
  head: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  badge: { color: '#e5b80b', fontSize: 12, lineHeight: '24px' },
  title: { fontSize: 17, lineHeight: 1.5, fontWeight: 900 },
  okTitle: { fontSize: 18, color: '#20d29b', fontWeight: 950 },
  body: { margin: 0, color: '#c3cad8', lineHeight: 1.7 },
  hint: { margin: 0, color: '#e5b80b', fontWeight: 800, fontSize: 14 },
  row: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, maxWidth: 420 },
  input: { minHeight: 50, minWidth: 0, border: '1px solid #3a4157', borderRadius: 10, background: '#0b0f1a', color: '#fff', padding: '0 14px', fontSize: 22, letterSpacing: 6, textAlign: 'center', fontWeight: 900, fontFamily: 'inherit' },
  button: { minHeight: 50, border: 0, borderRadius: 10, background: '#e5b80b', color: '#14110a', fontWeight: 950, fontSize: 16, padding: '0 22px', cursor: 'pointer' },
  error: { margin: 0, color: '#ff9aac', fontWeight: 800 },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
}
