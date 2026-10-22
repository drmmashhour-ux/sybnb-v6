import { BRAND_NAME } from '../../shared/brand/brandName'
import { useEffect, useState, type FormEvent } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import {
  becomeHost,
  createHostAccountSession,
  createSellerAccountSession,
  currentAccountIsHost,
  fetchHostVerification,
  getStoredGuestSession,
  getStoredStaffSession,
  signInGuestAccount,
} from '../../shared/api/platformApi'
import { HostVerificationCard } from '../host/HostVerificationCard'
import { ForgotPasswordPanel } from './ForgotPasswordPanel'
import { HOST_PROFILE_NEXT_KEY } from '../host/HostProfilePage'

// Host entrance (/host/join) -- owner decision of 2026-10-08, modelled on Booking.com's partner
// sign-up and Airbnb's "Airbnb your home":
//   - signed out: the SAME sign-in / sign-up as the rest of the site, inline (GuestAccountPage in
//     embedded mode). As soon as it signs in, hosting is turned on for that account (no extra tap)
//     and the host continues to the host profile, then the listing wizard.
//   - signed in, not a host: one "Start hosting" button (becomeHost), same continuation.
//   - signed in host, not verified yet: the onboarding tracker (listing -> review -> code by email ->
//     live; the code input shows only once a code was emailed), plus links to the profile / dashboard.
//   - signed in, verified host: straight to /host.

type Props = { lang: Lang }

// The host's "add listing" route (same one the host dashboard's "+ Create new listing" opens).
export const HOST_LISTING_WIZARD_PATH = '/sell/listing-wizard'

type View = 'checking' | 'signedOut' | 'notHost' | 'hostPending'

function accountIsHost() {
  if (currentAccountIsHost()) return true
  const roles = getStoredStaffSession()?.user?.roles || []
  return roles.includes('HOST') || roles.includes('SELLER')
}

function initialView(): View {
  if (accountIsHost()) return 'checking'
  return getStoredGuestSession() ? 'notHost' : 'signedOut'
}

export function HostJoinPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const [view, setView] = useState<View>(() => initialView())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const session = getStoredGuestSession()

  // A host lands here: verified -> dashboard; not verified yet -> show the activation step.
  useEffect(() => {
    if (view !== 'checking') return
    let alive = true
    fetchHostVerification()
      .then((status) => {
        if (!alive) return
        if (status.verified) navigate('/host')
        else setView('hostPending')
      })
      .catch(() => {
        if (alive) navigate('/host')
      })
    return () => {
      alive = false
    }
  }, [view])

  async function startHosting() {
    setBusy(true)
    setError('')
    try {
      await becomeHost()
      // Same continuation as BecomeHostPage: host profile first, then where they were heading --
      // here, the listing wizard.
      try {
        sessionStorage.setItem(HOST_PROFILE_NEXT_KEY, HOST_LISTING_WIZARD_PATH)
      } catch {
        /* ignore */
      }
      navigate('/host/profile')
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : pick(lang, 'تعذّر تفعيل الاستضافة. حاول مرة أخرى.', 'Could not turn on hosting. Please try again.', 'Impossible d’activer l’accueil. Veuillez réessayer.'))
      setView(getStoredGuestSession() ? 'notHost' : 'signedOut')
    } finally {
      setBusy(false)
    }
  }

  function onSignedIn() {
    // Signed in (or signed up) inline: an existing host goes to the check above; anyone else has
    // hosting turned on right away -- no second tap.
    if (accountIsHost()) {
      setView('checking')
      return
    }
    setView('notHost')
    void startHosting()
  }

  // Same 4 steps as the dashboard tracker (HostVerificationCard, owner decision 2026-10-09): the
  // activation code now comes at the END, emailed when the SYBNB team approves the listing.
  const steps = [
    {
      title: pick(lang, 'أضف إعلانك', 'Add your listing', 'Ajoutez votre annonce'),
      body: pick(lang, 'سجّل الدخول أو أنشئ حسابك، ثم أضف الصور والسعر والموقع.', 'Sign in or create your account, then add photos, price and location.', 'Connectez-vous ou créez votre compte, puis ajoutez photos, prix et emplacement.'),
    },
    {
      title: pick(lang, `المراجعة: فحص آلي + فريق ${BRAND_NAME}`, `Review: automatic check + ${BRAND_NAME} team`, `Vérification : contrôle automatique + équipe ${BRAND_NAME}`),
      body: pick(lang, 'نفحص الصور والعنوان والسعر آلياً، ثم يراجع فريقنا الإعلان. إن احتاج تعديلاً نخبرك بما يجب تصحيحه.', 'Photos, address and price are checked automatically, then our team reviews the listing. If it needs changes we tell you what to fix.', 'Photos, adresse et prix sont contrôlés automatiquement, puis notre équipe vérifie l’annonce. Si des corrections sont nécessaires, nous vous les indiquons.'),
    },
    {
      title: pick(lang, 'رمز التفعيل بالبريد', 'Activation code by email', 'Code d’activation par e-mail'),
      body: pick(lang, 'عند الموافقة نرسل إلى بريدك رمزاً من 6 أرقام. أدخله في لوحة المضيف.', 'When it is approved we email you a 6-digit code. Enter it in your host dashboard.', 'À l’approbation, nous vous envoyons un code à 6 chiffres par e-mail. Saisissez-le dans votre tableau de bord.'),
    },
    {
      title: pick(lang, 'إعلانك ظاهر للضيوف', 'Your listing is live for guests', 'Votre annonce est visible'),
      body: pick(lang, 'بعد إدخال الرمز يظهر إعلانك المعتمد للضيوف ويمكن حجزه.', 'Once the code is entered, your approved listing is shown to guests and can be booked.', 'Une fois le code saisi, votre annonce approuvée est visible et réservable.'),
    },
  ]

  const headline = pick(lang, `ابدأ الاستضافة على ${BRAND_NAME}`, `Start hosting on ${BRAND_NAME}`, `Devenez hôte sur ${BRAND_NAME}`)

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      {/* Grid areas live in global.css (.host-join-grid): desktop = intro + steps beside the
          sign-in panel; phones = intro, then the panel (above the fold), then the steps. */}
      <div className="host-join-grid">
        <section className="host-join-head" style={styles.intro} aria-labelledby="host-join-title">
          <span style={styles.eyebrow}>{pick(lang, 'للمضيفين', 'For hosts', 'Pour les hôtes')}</span>
          <h1 id="host-join-title" style={styles.title}>
            {view === 'hostPending' ? pick(lang, `أنت الآن مضيف على ${BRAND_NAME}`, `You are now a host on ${BRAND_NAME}`, `Vous êtes maintenant hôte sur ${BRAND_NAME}`) : headline}
          </h1>
          <p style={styles.body}>
            {pick(
              lang,
              'اعرض بيتك أو شقتك للإيجار اليومي، استقبل طلبات الحجز، وقرّر بنفسك من تقبل.',
              'List your home or apartment for short stays, receive booking requests, and decide who you accept.',
              'Proposez votre logement en courte durée, recevez des demandes de réservation et choisissez qui vous acceptez.',
            )}
          </p>
        </section>

        <section className="host-join-steps" style={styles.intro} aria-label={pick(lang, 'الخطوات', 'Steps', 'Étapes')}>
          <ol style={styles.steps}>
            {steps.map((step, index) => (
              <li key={step.title} style={styles.step}>
                <span style={styles.stepNumber} aria-hidden="true">{index + 1}</span>
                <span style={styles.stepText}>
                  <strong>{step.title}</strong>
                  <small style={styles.stepBody}>{step.body}</small>
                </span>
              </li>
            ))}
          </ol>
          <button style={styles.link} onClick={() => navigate('/host/why')}>
            {pick(lang, 'كيف تعمل الاستضافة والرسوم', 'How hosting works and fees', 'Fonctionnement et frais de l’accueil')}
          </button>
        </section>

        <section className="host-join-panel" style={styles.panel}>
          {view === 'signedOut' && (
            <HostAccountForm lang={lang} onSignedIn={onSignedIn} />
          )}

          {view === 'notHost' && (
            <div style={styles.box}>
              <h2 style={styles.boxTitle}>{headline}</h2>
              {session?.user && (
                <p style={styles.muted}>
                  {pick(lang, 'مسجّل الدخول باسم', 'Signed in as', 'Connecté en tant que')} <strong dir="ltr">{session.user.email}</strong>
                </p>
              )}
              {error && <strong role="alert" style={styles.error}>{error}</strong>}
              <button style={{ ...styles.primary, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={() => void startHosting()}>
                {busy ? '…' : pick(lang, 'ابدأ الاستضافة', 'Start hosting', 'Commencer à accueillir')}
              </button>
            </div>
          )}

          {view === 'checking' && (
            <div style={styles.box} role="status">
              <p style={styles.muted}>{pick(lang, 'جاري التحقق من حسابك…', 'Checking your account…', 'Vérification de votre compte…')}</p>
            </div>
          )}

          {view === 'hostPending' && (
            <div style={styles.box}>
              <HostVerificationCard lang={lang} showVerified />
              <div style={styles.actions}>
                <button style={styles.primary} onClick={() => navigate('/host/profile')}>
                  {pick(lang, 'ملفك كمضيف', 'Your host profile', 'Votre profil d’hôte')}
                </button>
                <button style={styles.secondary} onClick={() => navigate(HOST_LISTING_WIZARD_PATH)}>
                  {pick(lang, '+ أضف إعلاناً', '+ Add a listing', '+ Ajouter une annonce')}
                </button>
                <button style={styles.secondary} onClick={() => navigate('/host')}>
                  {pick(lang, 'لوحة الاستضافة', 'Hosting dashboard', 'Tableau de bord d’hôte')}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

// Host sign-up / sign-in, no emailed code: name, email typed twice, phone, password typed twice.
// kind 'SELLER' is the restaurant / store owner version (Eats merchant page): same fields, a seller account.
export function HostAccountForm({ lang, onSignedIn, kind = 'HOST' }: { lang: Lang; onSignedIn: () => void; kind?: 'HOST' | 'SELLER' }) {
  const [mode, setMode] = useState<'signup' | 'signin'>('signup')
  const [forgot, setForgot] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [repeatEmail, setRepeatEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const signup = mode === 'signup'

  function validate() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return pick(lang, 'أدخل بريداً إلكترونياً صحيحاً.', 'Enter a valid email.', 'Saisissez un courriel valide.')
    if (password.length < 8) return pick(lang, 'كلمة المرور 8 أحرف على الأقل.', 'Password needs at least 8 characters.', 'Le mot de passe doit avoir au moins 8 caractères.')
    if (!signup) return ''
    if (!firstName.trim() || !lastName.trim()) return pick(lang, 'أدخل الاسم الأول واسم العائلة.', 'Enter first and last name.', 'Saisissez le prénom et le nom.')
    if (email.trim().toLowerCase() !== repeatEmail.trim().toLowerCase()) return pick(lang, 'البريد وتأكيده غير متطابقين.', 'Email and repeated email do not match.', 'Le courriel et sa confirmation ne correspondent pas.')
    if (phone.replace(/\D/g, '').length < 7) return pick(lang, 'أدخل رقم هاتف صحيحاً.', 'Enter a valid phone number.', 'Saisissez un numéro de téléphone valide.')
    if (password !== repeatPassword) return pick(lang, 'كلمة المرور وتأكيدها غير متطابقين.', 'Password and repeated password do not match.', 'Le mot de passe et sa confirmation ne correspondent pas.')
    return ''
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError('')
    try {
      if (signup && kind === 'SELLER') {
        await createSellerAccountSession({ displayName: `${firstName.trim()} ${lastName.trim()}`.trim(), email: email.trim().toLowerCase(), password, phone: phone.trim(), sellerRole: 'restaurant', planCode: 'eats' })
      } else if (signup) await createHostAccountSession({ firstName: firstName.trim(), lastName: lastName.trim(), email, phone, password })
      else await signInGuestAccount(email, password)
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : pick(lang, 'تعذّر المتابعة. حاول مرة أخرى.', 'Could not continue. Please try again.', 'Impossible de continuer. Veuillez réessayer.'))
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, value: string, set: (v: string) => void, extra: { type?: string; auto?: string; ltr?: boolean } = {}) => (
    <label style={formStyles.label}>
      {label}
      <input
        style={formStyles.input}
        value={value}
        onChange={(event) => set(event.target.value)}
        type={extra.type || 'text'}
        autoComplete={extra.auto}
        dir={extra.ltr ? 'ltr' : undefined}
      />
    </label>
  )
  const pwType = showPassword ? 'text' : 'password'

  if (forgot) {
    return (
      <div style={styles.box}>
        <ForgotPasswordPanel lang={lang} initialEmail={email} onClose={() => setForgot(false)} />
      </div>
    )
  }

  return (
    <form style={styles.box} onSubmit={(event) => void submit(event)} noValidate>
      <h2 style={styles.boxTitle}>
        {signup ? (kind === 'SELLER' ? pick(lang, 'حساب المتجر', 'Store account', 'Compte commerçant') : pick(lang, 'حساب المضيف', 'Host account', 'Compte hôte')) : pick(lang, 'تسجيل الدخول', 'Sign in', 'Se connecter')}
      </h2>
      {signup && (
        <>
          {field(pick(lang, 'الاسم الأول', 'First name', 'Prénom'), firstName, setFirstName, { auto: 'given-name' })}
          {field(pick(lang, 'اسم العائلة', 'Last name', 'Nom de famille'), lastName, setLastName, { auto: 'family-name' })}
        </>
      )}
      {field(pick(lang, 'البريد الإلكتروني', 'Email', 'Courriel'), email, setEmail, { type: 'email', auto: 'email', ltr: true })}
      {signup && field(pick(lang, 'تأكيد البريد الإلكتروني', 'Repeat email', 'Confirmer le courriel'), repeatEmail, setRepeatEmail, { type: 'email', auto: 'off', ltr: true })}
      {signup && field(pick(lang, 'رقم الهاتف', 'Phone number', 'Numéro de téléphone'), phone, setPhone, { type: 'tel', auto: 'tel', ltr: true })}
      {field(pick(lang, 'كلمة المرور', 'Password', 'Mot de passe'), password, setPassword, { type: pwType, auto: signup ? 'new-password' : 'current-password', ltr: true })}
      {signup && field(pick(lang, 'تأكيد كلمة المرور', 'Repeat password', 'Confirmer le mot de passe'), repeatPassword, setRepeatPassword, { type: pwType, auto: 'new-password', ltr: true })}
      <button type="button" style={styles.link} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>
        {showPassword ? pick(lang, 'إخفاء كلمة المرور', 'Hide password', 'Masquer le mot de passe') : pick(lang, 'إظهار كلمة المرور', 'Show password', 'Afficher le mot de passe')}
      </button>
      {!signup && (
        <button type="button" style={styles.link} onClick={() => setForgot(true)}>
          {pick(lang, 'نسيت كلمة المرور؟', 'Forgot password?', 'Mot de passe oublié ?')}
        </button>
      )}
      {error && <strong role="alert" style={styles.error}>{error}</strong>}
      <button type="submit" style={{ ...styles.primary, opacity: busy ? 0.7 : 1 }} disabled={busy}>
        {busy ? '…' : signup ? pick(lang, 'إنشاء الحساب والبدء', 'Create account and start', 'Créer le compte et commencer') : pick(lang, 'تسجيل الدخول', 'Sign in', 'Se connecter')}
      </button>
      <button
        type="button"
        style={styles.link}
        onClick={() => {
          setMode(signup ? 'signin' : 'signup')
          setError('')
        }}
      >
        {signup ? pick(lang, 'لديك حساب؟ سجّل الدخول', 'Already have an account? Sign in', 'Déjà un compte ? Connectez-vous') : pick(lang, 'مضيف جديد؟ أنشئ حساباً', 'New host? Create an account', 'Nouvel hôte ? Créez un compte')}
      </button>
    </form>
  )
}

const formStyles: Record<string, CSSProperties> = {
  label: { display: 'grid', gap: 6, fontWeight: 800, fontSize: 14 },
  input: { minHeight: 48, borderRadius: 10, border: '1px solid #30384d', background: '#151a28', color: '#fff', padding: '0 12px', fontSize: 16 },
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: 'calc(100vh - 160px)', background: '#08090e', color: '#fff', padding: '24px 16px 90px' },
  intro: { display: 'grid', gap: 14, alignContent: 'start', minWidth: 0 },
  eyebrow: { color: '#e5b80b', fontWeight: 900, fontSize: 13, letterSpacing: 0.4 },
  title: { margin: 0, fontSize: 'clamp(28px, 4vw, 40px)', lineHeight: 1.2, fontWeight: 950 },
  body: { margin: 0, color: '#aab3c8', lineHeight: 1.7, fontSize: 16 },
  steps: { margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 },
  step: { display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr)', gap: 12, alignItems: 'start', border: '1px solid #232638', borderRadius: 12, background: '#0e0f16', padding: 14 },
  stepNumber: { width: 34, height: 34, borderRadius: 999, background: '#5268ff', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 950 },
  stepText: { display: 'grid', gap: 4, minWidth: 0 },
  stepBody: { color: '#9aa6ba', lineHeight: 1.6, fontSize: 14 },
  panel: { minWidth: 0 },
  box: { border: '1px solid #232638', borderRadius: 16, background: '#0e0f16', padding: 22, display: 'grid', gap: 14 },
  boxTitle: { margin: 0, fontSize: 22, fontWeight: 900 },
  muted: { margin: 0, color: '#9aa6ba', fontSize: 14 },
  error: { color: '#ff8f9f' },
  primary: { minHeight: 52, border: 0, borderRadius: 10, background: '#5268ff', color: '#fff', fontWeight: 900, fontSize: 16, cursor: 'pointer', padding: '0 18px' },
  secondary: { minHeight: 48, border: '1px solid #30384d', borderRadius: 10, background: '#151a28', color: '#fff', fontWeight: 900, cursor: 'pointer', padding: '0 16px' },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  link: { justifySelf: 'start', border: 0, background: 'transparent', color: '#9fb0ff', fontWeight: 800, textDecoration: 'underline', cursor: 'pointer', padding: 0 },
}
