import { useState } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { getStoredGuestSession, signOutGuest } from '@platform/shared/api/platformApi'

// Profile tab: who is signed in, links to the legal pages, and sign out (server-side revocation via
// the platform's signOutGuest). Account editing, wallet and hosting stay in the main SYBNB app.
export function ProfilePage({ lang }: { lang: Lang }) {
  const session = getStoredGuestSession()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function logout() {
    setBusy(true)
    try {
      const { serverRevoked } = await signOutGuest()
      if (!serverRevoked) {
        setNote(pick(lang, 'تم تسجيل الخروج على هذا الجهاز. تعذر الاتصال بالخادم لإلغاء الجلسة.', 'Logged out on this device. Could not reach the server to revoke the session.', 'Déconnecté sur cet appareil. Le serveur n’a pas pu révoquer la session.'))
      }
      window.location.hash = '/stays'
    } finally {
      setBusy(false)
    }
  }

  if (!session) {
    return (
      <main className="str-page str-narrow" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <h1 className="str-h1">{pick(lang, 'حسابي', 'Profile', 'Profil')}</h1>
        <button type="button" className="str-btn str-btn-primary str-btn-inline" onClick={() => (window.location.hash = '/account/open')}>
          {pick(lang, 'تسجيل الدخول', 'Log in', 'Se connecter')}
        </button>
      </main>
    )
  }

  const name = session.user.displayName || session.user.email || ''
  return (
    <main className="str-page str-narrow" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <h1 className="str-h1">{pick(lang, 'حسابي', 'Profile', 'Profil')}</h1>
      <div className="str-profile-card">
        <span className="str-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{name}</strong>
          {session.user.email && session.user.email !== name ? <div className="str-muted">{session.user.email}</div> : null}
        </div>
      </div>
      <div className="str-list">
        <a className="str-list-link" href="#/trips">{pick(lang, 'رحلاتي', 'My trips', 'Mes voyages')}</a>
        <a className="str-list-link" href="#/saved">{pick(lang, 'المحفوظات', 'Wishlists', 'Favoris')}</a>
        <a className="str-list-link" href="#/terms">{pick(lang, 'الشروط والأحكام', 'Terms of service', 'Conditions d’utilisation')}</a>
        <a className="str-list-link" href="#/privacy">{pick(lang, 'سياسة الخصوصية', 'Privacy policy', 'Politique de confidentialité')}</a>
      </div>
      {note ? <p className="str-note" role="status">{note}</p> : null}
      <button type="button" className="str-btn str-btn-outline str-btn-inline" disabled={busy} onClick={() => void logout()}>
        {pick(lang, 'تسجيل الخروج', 'Log out', 'Se déconnecter')}
      </button>
    </main>
  )
}
