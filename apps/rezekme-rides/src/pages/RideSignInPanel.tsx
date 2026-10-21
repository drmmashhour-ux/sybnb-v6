import { lazy, Suspense, useState, type CSSProperties } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { RiderSignInGate } from '@platform/shared/auth/RiderSignInGate'

const GuestAccountPage = lazy(() => import('@platform/modules/account/GuestAccountPage').then((m) => ({ default: m.GuestAccountPage })))

/**
 * Shown over the ride screen when the rider taps Continue without being signed in: the sign-in comes
 * right before paying, not at the start. The ride form underneath keeps everything the rider chose.
 * Closes itself (the parent hides it) as soon as a session exists.
 */
export function RideSignInPanel({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const [mode, setMode] = useState<'choose' | 'guest' | 'client'>('choose')
  const choose = (next: 'guest' | 'client') => {
    try { localStorage.setItem('rezekme.entryMode', next) } catch { /* ignore */ }
    setMode(next)
  }
  return (
    <div role="dialog" aria-modal="true" style={S.overlay}>
      <div style={S.sheet}>
        <button type="button" style={S.back} onClick={mode === 'choose' ? onClose : () => setMode('choose')}>
          {mode === 'choose' ? pick(lang, 'إغلاق', 'Close', 'Fermer') : '←'}
        </button>
        {mode === 'choose' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{pick(lang, 'سجّل دخولك لإكمال الطلب', 'Sign in to continue', 'Connectez-vous pour continuer')}</h1>
            <button type="button" style={S.primary} onClick={() => choose('client')}>
              {pick(lang, 'المتابعة كعميل', 'Continue as client', 'Continuer comme client')}
              <div style={S.sub}>{pick(lang, 'أنشئ حساباً مرة واحدة: معلوماتك وبطاقتك محفوظة وتبقى مسجلاً حتى تخرج.', 'Create an account once: your info and card are saved and you stay signed in until you log out.', 'Créez un compte une fois : vos infos et votre carte sont enregistrées et vous restez connecté jusqu’à la déconnexion.')}</div>
            </button>
            <button type="button" style={S.secondary} onClick={() => choose('guest')}>
              {pick(lang, 'المتابعة كضيف', 'Continue as guest', 'Continuer comme invité')}
              <div style={{ ...S.sub, opacity: 0.7 }}>{pick(lang, 'لمرة واحدة، بدون حساب. الدفع بالبطاقة، لا نقد.', 'One time, no account. Pay by card, no cash.', 'Une seule fois, sans compte. Paiement par carte, pas d’espèces.')}</div>
            </button>
          </div>
        )}
        {mode === 'guest' && <RiderSignInGate lang={lang} codeFree onSignedIn={() => window.dispatchEvent(new Event('sybnb-session-changed'))} />}
        {mode === 'client' && (
          <Suspense fallback={null}>
            <GuestAccountPage lang={lang} flow="ride" returnPath="/ride" />
          </Suspense>
        )}
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.45)', display: 'grid', alignItems: 'end', justifyItems: 'center', overflowY: 'auto' },
  sheet: { width: '100%', maxWidth: 520, background: '#fff', borderRadius: '20px 20px 0 0', padding: '16px 16px 28px', boxSizing: 'border-box', maxHeight: '92vh', overflowY: 'auto' },
  back: { marginBottom: 12, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: 14 },
  primary: { padding: '16px 18px', borderRadius: 14, border: '2px solid #111', background: '#111', color: '#fff', fontSize: 17, fontWeight: 700, textAlign: 'start', cursor: 'pointer' },
  secondary: { padding: '16px 18px', borderRadius: 14, border: '2px solid #111', background: '#fff', color: '#111', fontSize: 17, fontWeight: 700, textAlign: 'start', cursor: 'pointer' },
  sub: { fontSize: 13, fontWeight: 400, opacity: 0.85, marginTop: 4 },
}
