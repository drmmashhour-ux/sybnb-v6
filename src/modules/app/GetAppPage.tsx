import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { pick } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'

// "Get the app" (/get-app) -- public. Two honest install paths:
//  1) Store buttons: shown ONLY when the real store URLs are configured at build time
//     (VITE_PLAY_STORE_URL / VITE_APP_STORE_URL). Never a fake or placeholder store link.
//  2) Install as an app straight from the browser (PWA): Android/Chrome "Install" prompt, or the
//     iPhone Safari Share -> "Add to Home Screen" steps. The manifest also adds long-press
//     shortcuts for SR rides and Daily stays.
// Hidden inside the native Capacitor app (nothing to install there).

type Props = { lang: Lang }

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const PLAY_URL = String(import.meta.env.VITE_PLAY_STORE_URL || '').trim()
const APP_STORE_URL = String(import.meta.env.VITE_APP_STORE_URL || '').trim()

function isNativeApp() {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return Boolean(cap?.isNativePlatform?.())
}
function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
}
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function GetAppPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const native = typeof window !== 'undefined' && isNativeApp()
  const standalone = typeof window !== 'undefined' && isStandalone()
  const ios = typeof window !== 'undefined' && isIos()

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPrompt(event as InstallPromptEvent)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async () => {
    if (!prompt) return
    await prompt.prompt()
    const choice = await prompt.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    setPrompt(null)
  }

  const t = {
    eyebrow: pick(lang, 'التطبيق', 'The app', 'L’application'),
    title: pick(lang, 'SYBNB على هاتفك', 'SYBNB on your phone', 'SYBNB sur votre téléphone'),
    sub: pick(
      lang,
      'رحلات SR والإقامات اليومية وكل خدمات SYBNB بنقرة واحدة من شاشة هاتفك الرئيسية.',
      'SR rides, daily stays and everything on SYBNB, one tap from your home screen.',
      'Courses SR, séjours et tout SYBNB, à un geste de votre écran d’accueil.',
    ),
    nativeNote: pick(lang, 'أنت تستخدم تطبيق SYBNB بالفعل.', 'You are already using the SYBNB app.', 'Vous utilisez déjà l’application SYBNB.'),
    installedNote: pick(lang, 'تم تثبيت SYBNB على جهازك.', 'SYBNB is installed on your device.', 'SYBNB est installé sur votre appareil.'),
    storeTitle: pick(lang, 'من المتجر', 'From the store', 'Depuis la boutique'),
    play: pick(lang, 'احصل عليه من Google Play', 'Get it on Google Play', 'Disponible sur Google Play'),
    appStore: pick(lang, 'حمّله من App Store', 'Download on the App Store', 'Télécharger sur l’App Store'),
    storeSoon: pick(
      lang,
      'تطبيق المتجر قيد الإعداد. يمكنك تثبيت SYBNB الآن من المتصفح كما يلي.',
      'The store app is being prepared. You can install SYBNB from your browser now, as shown below.',
      'L’application sur les boutiques est en préparation. Vous pouvez installer SYBNB dès maintenant depuis le navigateur.',
    ),
    browserTitle: pick(lang, 'التثبيت من المتصفح', 'Install from your browser', 'Installer depuis le navigateur'),
    installBtn: pick(lang, 'ثبّت SYBNB', 'Install SYBNB', 'Installer SYBNB'),
    androidSteps: pick(
      lang,
      'على أندرويد (Chrome): اضغط ⋮ ثم «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية». اضغط مطولاً على الأيقونة لاختصارات رحلات SR والإقامات.',
      'On Android (Chrome): tap ⋮, then “Install app” or “Add to Home screen”. Long-press the icon for SR rides and Stays shortcuts.',
      'Sur Android (Chrome) : touchez ⋮ puis « Installer l’application » ou « Ajouter à l’écran d’accueil ». Appui long sur l’icône pour les raccourcis Courses SR et Séjours.',
    ),
    iosSteps: pick(
      lang,
      'على آيفون (Safari): اضغط زر المشاركة ⬆ ثم «إضافة إلى الشاشة الرئيسية».',
      'On iPhone (Safari): tap the Share button ⬆, then “Add to Home Screen”.',
      'Sur iPhone (Safari) : touchez le bouton Partager ⬆ puis « Sur l’écran d’accueil ».',
    ),
    quickTitle: pick(lang, 'افتح مباشرة', 'Open directly', 'Ouvrir directement'),
    srBtn: pick(lang, 'رحلات SR', 'SR rides', 'Courses SR'),
    strBtn: pick(lang, 'الإقامات اليومية (STR)', 'Daily stays (STR)', 'Séjours (STR)'),
  }

  const showStores = Boolean(PLAY_URL || APP_STORE_URL)

  return (
    <main style={styles.page} dir={isAr ? 'rtl' : 'ltr'}>
      <section style={styles.hero}>
        <span style={styles.eyebrow}>{t.eyebrow}</span>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.sub}>{t.sub}</p>
      </section>

      {native ? (
        <section style={styles.card}><p style={styles.note}>{t.nativeNote}</p></section>
      ) : (
        <>
          <section style={styles.card}>
            <h2 style={styles.h2}>{t.storeTitle}</h2>
            {showStores ? (
              <div style={styles.buttons}>
                {PLAY_URL ? <a style={styles.storeBtn} href={PLAY_URL} target="_blank" rel="noopener noreferrer">{t.play}</a> : null}
                {APP_STORE_URL ? <a style={styles.storeBtn} href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">{t.appStore}</a> : null}
              </div>
            ) : (
              <p style={styles.note}>{t.storeSoon}</p>
            )}
          </section>

          <section style={styles.card}>
            <h2 style={styles.h2}>{t.browserTitle}</h2>
            {standalone || installed ? (
              <p style={styles.note}>{t.installedNote}</p>
            ) : (
              <>
                {prompt ? <button type="button" style={styles.primary} onClick={() => void install()}>{t.installBtn}</button> : null}
                <p style={styles.note}>{ios ? t.iosSteps : t.androidSteps}</p>
                {!ios ? <p style={styles.noteSmall}>{t.iosSteps}</p> : <p style={styles.noteSmall}>{t.androidSteps}</p>}
              </>
            )}
          </section>
        </>
      )}

      <section style={styles.card}>
        <h2 style={styles.h2}>{t.quickTitle}</h2>
        <div style={styles.buttons}>
          <button type="button" style={styles.secondary} onClick={() => navigate('/ride')}>{t.srBtn}</button>
          <button type="button" style={styles.secondary} onClick={() => navigate('/stays')}>{t.strBtn}</button>
        </div>
      </section>
    </main>
  )
}

export default GetAppPage

const styles: Record<string, CSSProperties> = {
  page: { display: 'grid', gap: 16, maxWidth: 720, margin: '0 auto', padding: '24px 16px 48px', minWidth: 0 },
  hero: { display: 'grid', gap: 8 },
  eyebrow: { color: '#20d29b', fontWeight: 800, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' },
  title: { margin: 0, fontSize: 'clamp(26px, 6vw, 38px)', lineHeight: 1.15 },
  sub: { margin: 0, color: '#aab2c5', lineHeight: 1.6 },
  card: { background: '#111118', border: '1px solid #262b3a', borderRadius: 16, padding: 18, display: 'grid', gap: 12, minWidth: 0 },
  h2: { margin: 0, fontSize: 18 },
  note: { margin: 0, color: '#c9cfdd', lineHeight: 1.6 },
  noteSmall: { margin: 0, color: '#8c95aa', lineHeight: 1.6, fontSize: 14 },
  buttons: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  storeBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, padding: '0 18px', borderRadius: 12, background: '#fff', color: '#0a0f1d', fontWeight: 800, textDecoration: 'none' },
  primary: { minHeight: 48, borderRadius: 12, border: 0, background: '#5b74ff', color: '#fff', fontWeight: 800, fontSize: 16, padding: '0 20px', cursor: 'pointer' },
  secondary: { minHeight: 48, borderRadius: 12, border: '1px solid #3a4260', background: 'transparent', color: '#fff', fontWeight: 700, fontSize: 15, padding: '0 18px', cursor: 'pointer' },
}
