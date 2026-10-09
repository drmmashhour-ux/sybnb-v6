import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import {
  becomeHost,
  currentAccountIsHost,
  fetchHostVerification,
  getStoredGuestSession,
  getStoredStaffSession,
} from '../../shared/api/platformApi'
import { GuestAccountPage } from './GuestAccountPage'
import { HostVerificationCard } from '../host/HostVerificationCard'
import { HOST_PROFILE_NEXT_KEY } from '../host/HostProfilePage'

// Host entrance (/host/join) -- owner decision of 2026-10-08, modelled on Booking.com's partner
// sign-up and Airbnb's "Airbnb your home":
//   - signed out: the SAME sign-in / sign-up as the rest of the site, inline (GuestAccountPage in
//     embedded mode). As soon as it signs in, hosting is turned on for that account (no extra tap)
//     and the host continues to the host profile, then the listing wizard.
//   - signed in, not a host: one "Start hosting" button (becomeHost), same continuation.
//   - signed in host, not verified yet: the activation-code step (a host's stays stay hidden until
//     the SYBNB team's 6-digit code is entered), plus links to the profile / dashboard.
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

  const steps = [
    {
      title: pick(lang, 'أنشئ حسابك أو سجّل الدخول', 'Create your account or sign in', 'Créez votre compte ou connectez-vous'),
      body: pick(lang, 'حساب واحد للحجز وللاستضافة.', 'One account for booking and hosting.', 'Un seul compte pour réserver et accueillir.'),
    },
    {
      title: pick(lang, 'عرّف بنفسك وأضف إعلانك', 'Introduce yourself and add your listing', 'Présentez-vous et ajoutez votre annonce'),
      body: pick(lang, 'ملف المضيف ثم الصور والسعر والموقع.', 'Your host profile, then photos, price and location.', 'Votre profil d’hôte, puis photos, prix et emplacement.'),
    },
    {
      title: pick(lang, 'تحقّق برمز التفعيل', 'Get verified with an activation code', 'Faites-vous vérifier avec un code d’activation'),
      body: pick(
        lang,
        'يتواصل معك فريق SYBNB ويعطيك رمزاً من 6 أرقام. بعد إدخاله يظهر إعلانك المعتمد للضيوف.',
        'The SYBNB team contacts you and gives you a 6-digit code. Once entered, your approved listing is shown to guests.',
        'L’équipe SYBNB vous contacte et vous donne un code à 6 chiffres. Une fois saisi, votre annonce approuvée est visible.',
      ),
    },
  ]

  const headline = pick(lang, 'ابدأ الاستضافة على SYBNB', 'Start hosting on SYBNB', 'Devenez hôte sur SYBNB')

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      {/* Grid areas live in global.css (.host-join-grid): desktop = intro + steps beside the
          sign-in panel; phones = intro, then the panel (above the fold), then the steps. */}
      <div className="host-join-grid">
        <section className="host-join-head" style={styles.intro} aria-labelledby="host-join-title">
          <span style={styles.eyebrow}>{pick(lang, 'للمضيفين', 'For hosts', 'Pour les hôtes')}</span>
          <h1 id="host-join-title" style={styles.title}>
            {view === 'hostPending' ? pick(lang, 'أنت الآن مضيف على SYBNB', 'You are now a host on SYBNB', 'Vous êtes maintenant hôte sur SYBNB') : headline}
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
            <GuestAccountPage
              lang={lang}
              flow="generic"
              returnPath="/host/join"
              embedded
              embeddedTitle={pick(lang, 'حساب المضيف', 'Host account', 'Compte hôte')}
              initialMode="signup"
              onSignedIn={onSignedIn}
            />
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
