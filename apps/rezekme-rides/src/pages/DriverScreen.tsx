import { useCallback, useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type ReactNode } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import {
  claimPrototypeSrRide,
  acceptSrOffer,
  declineSrOffer,
  clearStoredStaffSession,
  confirmOtp,
  createStaffAccountSession,
  fetchDriverIdentityStatus,
  fetchPendingSrRidesEx,
  fetchPrototypeSrRideThread,
  sendPrototypeSrRideMessage,
  triggerSrSos,
  fetchPrototypeDriverOverview,
  getStoredStaffSession,
  markDriverArrived,
  markRiderNoShow,
  reportPrototypeDriverLocation,
  requestOtp,
  saveDriverVehicle,
  submitDriverIdDocument,
  updatePrototypeDriverRideStatus,
  verifySrPickup,
  type PlatformDriverOverview,
  type PlatformMessage,
  type PlatformRideRequest,
} from '@platform/shared/api/platformApi'

import { fetchDriverBase, fetchPayouts, requestPayout, verifyKeyCode, type DriverBase } from '../driverBaseApi'
import { MapHero } from '../maps/MapHero'
import { RecordingControls } from './RecordingControls'
import { RouteViewer } from './RouteViewer'

/**
 * Rezekme driver screen: the phone-sized view a driver sees (not the full SYBNB dashboard).
 * 1) sign in  2) finish registration (ID + vehicle)  3) go online, take offers, run the trip,
 * see earnings. Uses the same server routes as the SYBNB driver dashboard; nothing about fares,
 * commission or payments is decided here.
 */

const LIVE = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
const GPS_EVERY_MS = 8000

function money(minor: number | null | undefined, currency = 'USD') {
  const n = Number(minor ?? 0)
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n)
  } catch {
    return `${n} ${currency}`
  }
}

/** Current Google Maps URL format; opens the Google Maps app (turn-by-turn) on a phone. */
function navUrl(ride: PlatformRideRequest, toDropoff: boolean) {
  const coords = toDropoff ? ride.dropoffCoords : ride.pickupCoords
  const text = String((toDropoff ? ride.metadata.dropoff : ride.metadata.pickup) || '')
  const destination = coords ? `${coords.lat},${coords.lng}` : text
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving&dir_action=navigate`
}

export function DriverScreen({ lang }: { lang: Lang }) {
  const [session, setSession] = useState(() => getStoredStaffSession('DRIVER'))

  useEffect(() => {
    const sync = () => setSession(getStoredStaffSession('DRIVER'))
    window.addEventListener('sybnb-session-changed', sync)
    return () => window.removeEventListener('sybnb-session-changed', sync)
  }, [])

  if (!session) return <SignIn lang={lang} onDone={() => setSession(getStoredStaffSession('DRIVER'))} />
  return (
    <Home
      lang={lang}
      name={session.user.displayName}
      onSignOut={() => {
        clearStoredStaffSession()
        setSession(null)
      }}
    />
  )
}

/* ------------------------------------------------------------------ sign in */

function SignIn({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [purpose, setPurpose] = useState<'staff-login' | 'admin-login'>('staff-login')
  const [sent, setSent] = useState(false)
  const [needsAdmin, setNeedsAdmin] = useState(false)
  const [adminMode, setAdminMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function sendCode(p = purpose) {
    setMsg('')
    setBusy(true)
    try {
      await requestOtp({ email: email.trim(), purpose: p })
      setSent(true)
      setMsg(t('أرسلنا رمزاً إلى بريدك.', 'We emailed you a code.', 'Nous vous avons envoyé un code.'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('تعذر إرسال الرمز', 'Could not send the code', 'Envoi du code impossible'))
    } finally {
      setBusy(false)
    }
  }

  async function signIn() {
    setMsg('')
    setBusy(true)
    try {
      const ok = await confirmOtp({ email: email.trim(), purpose, code: code.trim() }).catch(() => false)
      if (!ok) {
        setMsg(t('الرمز غير صحيح أو منتهي.', 'That code is wrong or expired.', 'Code incorrect ou expiré.'))
        return
      }
      await createStaffAccountSession(adminMode ? 'ADMIN' : 'DRIVER', { email, password })
      if (!getStoredStaffSession('DRIVER')) {
        clearStoredStaffSession()
        setMsg(t('هذا الحساب ليس سائقاً.', 'This account is not a driver.', 'Ce compte n’est pas chauffeur.'))
        return
      }
      window.dispatchEvent(new Event('sybnb-session-changed'))
      onDone()
    } catch (e) {
      // The server refuses an account that also holds an admin role until an admin-login code is used;
      // the client falls back to a register() call whose own error hides that reason, so offer it.
      // Admin accounts need the admin-login code. Request it right away and switch the form to it.
      setAdminMode(true)
      setPurpose('admin-login')
      setCode('')
      try {
        await requestOtp({ email: email.trim(), purpose: 'admin-login' })
        setSent(true)
        setMsg(t('هذا الحساب إداري أيضاً. أرسلنا رمز إدارة جديداً إلى بريدك: أدخله هنا واضغط دخول.', 'This account is also an admin account. We emailed a NEW admin code: enter it here and press Sign in.', 'Ce compte est aussi administrateur. Un NOUVEAU code admin a été envoyé : saisissez-le ici puis appuyez sur Connexion.'))
      } catch (err2) {
        setSent(false)
        setMsg((e as { message?: string }).message || (err2 as { message?: string }).message || t('تعذر تسجيل الدخول', 'Could not sign in', 'Connexion impossible'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} style={S.page}>
      <h1 style={S.h1}>{t('سائق Rezekme', 'Rezekme Driver', 'Chauffeur Rezekme')}</h1>
      <p style={S.muted}>{t('سجّل دخولك لتستقبل الرحلات.', 'Sign in to receive rides.', 'Connectez-vous pour recevoir des courses.')}</p>
      <label style={S.label}>{t('البريد الإلكتروني', 'Email', 'Courriel')}</label>
      <input style={S.input} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label style={S.label}>{t('كلمة المرور', 'Password', 'Mot de passe')}</label>
      <input style={S.input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {sent && (
        <>
          <label style={S.label}>{t('رمز الدخول', 'Sign-in code', 'Code de connexion')}</label>
          <input style={S.input} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </>
      )}
      {msg && <p style={S.note}>{msg}</p>}
      {needsAdmin && !sent && (
        <button
          style={S.secondary}
          disabled={busy}
          onClick={() => {
            setAdminMode(true)
            setPurpose('admin-login')
            setNeedsAdmin(false)
            void sendCode('admin-login')
          }}
        >
          {t('حسابي إداري أيضاً: استخدم رمز الإدارة', 'My account is also admin: use the admin code', 'Mon compte est aussi admin : utiliser le code admin')}
        </button>
      )}
      {!sent ? (
        <button style={S.primary} disabled={busy || !email || !password} onClick={() => void sendCode()}>
          {t('إرسال الرمز', 'Send code', 'Envoyer le code')}
        </button>
      ) : (
        <>
          <button style={S.primary} disabled={busy || code.trim().length < 6} onClick={() => void signIn()}>
            {t('دخول', 'Sign in', 'Connexion')}
          </button>
          <button style={S.link} disabled={busy} onClick={() => void sendCode()}>
            {t('إعادة إرسال الرمز', 'Resend code', 'Renvoyer le code')}
          </button>
        </>
      )}
    </main>
  )
}

/* --------------------------------------------------------------------- home */

function Home({ lang, name, onSignOut }: { lang: Lang; name: string; onSignOut: () => void }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [overview, setOverview] = useState<PlatformDriverOverview | null>(null)
  const [idStatus, setIdStatus] = useState<string | null | undefined>(undefined)
  const [pending, setPending] = useState<PlatformRideRequest[]>([])
  const [hiddenTooBig, setHiddenTooBig] = useState(0)
  const [base, setBase] = useState<DriverBase | null>(null)
  const [online, setOnline] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ fare: number; currency: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const [o, id] = await Promise.all([fetchPrototypeDriverOverview(), fetchDriverIdentityStatus()])
      setOverview(o)
      setIdStatus(id)
      fetchDriverBase().then(setBase).catch(() => undefined)
    } catch (e) {
      const err = e as { status?: number; message?: string }
      if (err.status === 401) onSignOut()
      else setError(err.message || '')
    }
  }, [onSignOut])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 6000)
    return () => window.clearInterval(id)
  }, [load])

  const active = overview?.rides.find((r) => LIVE.includes(r.status)) ?? null
  const driver = overview?.driver
  const idApproved = idStatus === 'APPROVED'
  const vehicleOk = Boolean(driver?.vehiclePlate) && driver?.vehicleStatus === 'APPROVED'
  const inspectionOk = !driver?.inspectionRequired || driver?.inspectionStatus === 'PASSED'
  const registered = idApproved && vehicleOk && inspectionOk
  // Shared driver base: on duty (key code entered) with every document valid. Nothing is dispatched before.
  const onDuty = Boolean(base?.onDutyAt) && (base?.dutyBlockers.length ?? 1) === 0
  const ready = registered && onDuty

  // GPS: reported while online or during a live trip, so dispatch and the rider's map can see us.
  const tracking = ready && (online || Boolean(active))
  useEffect(() => {
    if (!tracking || !navigator.geolocation) return
    let last = 0
    const send = (p: GeolocationPosition) => {
      const now = Date.now()
      if (now - last < GPS_EVERY_MS) return
      last = now
      void reportPrototypeDriverLocation(p.coords.latitude, p.coords.longitude).catch(() => undefined)
    }
    const watch = navigator.geolocation.watchPosition(send, () => setError(t('فعّل الموقع (GPS).', 'Turn on location (GPS).', 'Activez la localisation (GPS).')), { enableHighAccuracy: true, maximumAge: 5000 })
    return () => navigator.geolocation.clearWatch(watch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking])

  // Offers: poll while online and idle.
  useEffect(() => {
    if (!ready || !online || active) {
      setPending([])
      return
    }
    let stop = false
    const tick = () => fetchPendingSrRidesEx().then((r) => { if (stop) return; setPending(r.rides); setHiddenTooBig(r.hiddenTooBig ?? 0) }).catch(() => undefined)
    void tick()
    const id = window.setInterval(tick, 4000)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [ready, online, active])

  const rate = overview?.totals.commissionRate ?? 0.2
  const currency = overview?.totals.currency || 'USD'

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} style={S.page}>
      <div style={S.row}>
        <div>
          <div style={S.muted}>{t('مرحباً', 'Hello', 'Bonjour')}</div>
          <strong style={{ fontSize: 18 }}>{name}</strong>
        </div>
        <button style={S.link} onClick={onSignOut}>{t('خروج', 'Sign out', 'Quitter')}</button>
      </div>
      {error && <p style={S.note}>{error}</p>}
      {base?.lowRating && (
        <p style={S.note} role="alert">
          {t(
            `تنبيه: متوسط تقييمك ${base.rating.averageRating?.toFixed(2)} وهو أقل من ${base.lowRatingThreshold ?? 4.6}. حسّن الخدمة حتى لا يتم إيقاف حسابك.`,
            `Warning: your average rating is ${base.rating.averageRating?.toFixed(2)}, below ${base.lowRatingThreshold ?? 4.6}. Please improve your service to keep your account active.`,
            `Attention : votre note moyenne est de ${base.rating.averageRating?.toFixed(2)}, sous ${base.lowRatingThreshold ?? 4.6}. Améliorez votre service pour garder votre compte actif.`,
          )}
        </p>
      )}

      {!overview || idStatus === undefined ? (
        <p style={S.muted}>…</p>
      ) : registered && !onDuty && !active ? (
        <StartWork lang={lang} base={base} onChanged={() => void load()} />
      ) : !ready && !active ? (
        <Onboarding
          lang={lang}
          idStatus={idStatus}
          driver={overview.driver}
          idApproved={idApproved}
          vehicleOk={vehicleOk}
          inspectionOk={inspectionOk}
          onChanged={() => void load()}
        />
      ) : active ? (
        <Trip lang={lang} ride={active} rate={rate} onChanged={() => void load()} onCompleted={(fare, cur) => setDone({ fare, currency: cur })} />
      ) : (
        <>
          {done && (
            <div style={{ ...S.card, background: '#e8f7ee', borderColor: '#9bd5b0' }}>
              <strong>{t('اكتملت الرحلة', 'Trip completed', 'Course terminée')}</strong>
              <div>{t('ربحك', 'You earned', 'Vous avez gagné')} {money(done.fare * (1 - rate), done.currency)}</div>
              <button style={S.link} onClick={() => setDone(null)}>{t('إخفاء', 'Dismiss', 'Fermer')}</button>
            </div>
          )}
          <button style={online ? S.onlineOn : S.primary} onClick={() => setOnline((v) => !v)}>
            {online ? t('أنت متصل. اضغط للإيقاف', 'You are online. Tap to go offline', 'En ligne. Touchez pour passer hors ligne') : t('ابدأ الاستقبال', 'Go online', 'Se mettre en ligne')}
          </button>
          {online && pending.length === 0 && <p style={S.muted}>{t('نبحث عن طلبات قريبة…', 'Looking for nearby requests…', 'Recherche de demandes proches…')}</p>}
          {online && pending.length > 0 && (
            <div style={S.muted}>{pending.length} {t('طلبات حولك. الأقرب أولاً.', 'requests around you. Nearest first.', 'demandes autour de vous. La plus proche d’abord.')}</div>
          )}
          {pending.map((ride, i) => (
            <Offer key={ride.id} lang={lang} ride={ride} rate={rate} nearest={i === 0 && typeof ride.pickupDistanceKm === 'number'} onChanged={() => void load()} />
          ))}
          {online && hiddenTooBig > 0 && (
            <p style={S.note}>{hiddenTooBig} {t('طلب مخفي لأن سيارتك لا تتسع لحقائبه.', 'request hidden: your car cannot carry its luggage.', 'demande masquée : votre voiture ne peut pas porter ses bagages.')}</p>
          )}
          <Earnings lang={lang} overview={overview} rate={rate} currency={currency} />
        </>
      )}
    </main>
  )
}

/* --------------------------------------------------------------- onboarding */

function Step({ ok, title, hint, children }: { ok: boolean; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div style={S.card}>
      <div style={S.row}>
        <strong>{title}</strong>
        <span style={{ ...S.pill, background: ok ? '#e8f7ee' : '#fff4e0', color: ok ? '#116b34' : '#8a5300' }}>{ok ? '✓' : '•'}</span>
      </div>
      {hint && <div style={S.muted}>{hint}</div>}
      {children}
    </div>
  )
}

function Onboarding({ lang, idStatus, driver, idApproved, vehicleOk, inspectionOk, onChanged }: {
  lang: Lang
  idStatus: string | null | undefined
  driver: PlatformDriverOverview['driver']
  idApproved: boolean
  vehicleOk: boolean
  inspectionOk: boolean
  onChanged: () => void
}) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [form, setForm] = useState({
    vehicleMake: driver.vehicleMake || '',
    vehicleModel: driver.vehicleModel || '',
    vehiclePlate: driver.vehiclePlate || '',
    vehicleYear: driver.vehicleYear ? String(driver.vehicleYear) : '',
    vehicleColor: driver.vehicleColor || '',
    vehicleCategory: (driver.vehicleCategory || 'ECONOMY') as 'BIKE' | 'ECONOMY' | 'COMFORT' | 'SUV' | 'VAN',
  })
  const idPending = idStatus === 'PENDING_REVIEW' || idStatus === 'PENDING'
  const vehicleSaved = Boolean(driver.vehiclePlate)

  async function uploadId(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setMsg('')
    try {
      await submitDriverIdDocument(file)
      onChanged()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveVehicle() {
    setBusy(true)
    setMsg('')
    try {
      await saveDriverVehicle({
        vehicleMake: form.vehicleMake.trim(),
        vehicleModel: form.vehicleModel.trim(),
        vehiclePlate: form.vehiclePlate.trim(),
        vehicleCategory: form.vehicleCategory,
        vehicleYear: form.vehicleYear ? Number(form.vehicleYear) : null,
        vehicleColor: form.vehicleColor.trim() || null,
      })
      onChanged()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <>
      <h1 style={S.h1}>{t('أكمل تسجيلك', 'Finish your registration', 'Terminez votre inscription')}</h1>
      <p style={S.muted}>{t('عندما تكتمل الخطوات والمراجعة ستظهر شاشة الرحلات.', 'When every step is done and reviewed, your rides screen opens.', 'Quand tout est validé, votre écran de courses s’ouvre.')}</p>

      <Step
        ok={idApproved}
        title={t('1. وثيقة الهوية', '1. ID document', '1. Pièce d’identité')}
        hint={idApproved ? t('تمت الموافقة', 'Approved', 'Approuvée') : idPending ? t('قيد المراجعة من فريقنا', 'Under review by our team', 'En cours de vérification') : idStatus === 'REJECTED' ? t('مرفوضة، ارفع وثيقة أوضح', 'Rejected, upload a clearer photo', 'Refusée, envoyez une photo plus nette') : t('ارفع صورة واضحة لهويتك', 'Upload a clear photo of your ID', 'Envoyez une photo nette de votre pièce')}
      >
        {!idApproved && !idPending && (
          <input type="file" accept="image/*" capture="environment" disabled={busy} onChange={(e) => void uploadId(e.target.files?.[0])} />
        )}
      </Step>

      <Step ok={vehicleOk} title={t('2. المركبة', '2. Vehicle', '2. Véhicule')} hint={vehicleOk ? `${driver.vehicleMake || ''} ${driver.vehicleModel || ''} · ${driver.vehiclePlate || ''}` : vehicleSaved ? (driver.vehicleStatus === 'REJECTED' ? t('مرفوضة، عدّل البيانات', 'Rejected, update the details', 'Refusé, modifiez les informations') : t('قيد المراجعة من فريقنا', 'Under review by our team', 'En cours de vérification')) : t('أدخل بيانات مركبتك', 'Enter your vehicle details', 'Saisissez votre véhicule')}>
        {!vehicleOk && (!vehicleSaved || driver.vehicleStatus === 'REJECTED') && (
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <input style={S.input} placeholder={t('الصنع', 'Make', 'Marque')} value={form.vehicleMake} onChange={set('vehicleMake')} />
            <input style={S.input} placeholder={t('الطراز', 'Model', 'Modèle')} value={form.vehicleModel} onChange={set('vehicleModel')} />
            <input style={S.input} placeholder={t('رقم اللوحة', 'Plate number', 'Plaque')} value={form.vehiclePlate} onChange={set('vehiclePlate')} />
            <input style={S.input} placeholder={t('السنة', 'Year', 'Année')} inputMode="numeric" value={form.vehicleYear} onChange={set('vehicleYear')} />
            <input style={S.input} placeholder={t('اللون', 'Color', 'Couleur')} value={form.vehicleColor} onChange={set('vehicleColor')} />
            <select style={S.input} value={form.vehicleCategory} onChange={set('vehicleCategory')}>
              {['BIKE', 'ECONOMY', 'COMFORT', 'SUV', 'VAN'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button style={S.primary} disabled={busy || !form.vehicleMake || !form.vehicleModel || !form.vehiclePlate} onClick={() => void saveVehicle()}>
              {t('حفظ المركبة', 'Save vehicle', 'Enregistrer')}
            </button>
          </div>
        )}
      </Step>

      {driver.inspectionRequired && (
        <Step ok={inspectionOk} title={t('3. فحص المركبة', '3. Vehicle inspection', '3. Inspection du véhicule')} hint={inspectionOk ? t('تم الاجتياز', 'Passed', 'Réussie') : t('بانتظار فريقنا', 'Waiting for our team', 'En attente de notre équipe')} />
      )}
      {msg && <p style={S.note}>{msg}</p>}
    </>
  )
}

/* -------------------------------------------------------------------- offer */

function Offer({ lang, ride, rate, nearest, onChanged }: { lang: Lang; ride: PlatformRideRequest; rate: number; nearest: boolean; onChanged: () => void }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [left, setLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!ride.offerExpiresAt) return
    const tick = () => setLeft(Math.max(0, Math.round((new Date(ride.offerExpiresAt as string).getTime() - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [ride.offerExpiresAt])

  async function accept() {
    setBusy(true)
    setMsg('')
    try {
      if (ride.offeredToYou) await acceptSrOffer(ride.id)
      else await claimPrototypeSrRide(ride.id)
      onChanged()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not accept')
    } finally {
      setBusy(false)
    }
  }
  async function decline() {
    setBusy(true)
    try {
      if (ride.offeredToYou) await declineSrOffer(ride.id)
      onChanged()
    } catch {
      /* the next poll refreshes the list */
    } finally {
      setBusy(false)
    }
  }

  const net = (ride.fareMinor ?? 0) * (1 - rate)
  return (
    <div style={{ ...S.card, borderColor: '#000', borderWidth: 2 }}>
      <div style={S.row}>
        <strong style={{ fontSize: 26 }}>{money(net, ride.currency)}</strong>
        <span style={{ display: 'flex', gap: 6 }}>
          {nearest && <span style={{ ...S.pill, background: '#e8f7ee', color: '#116b34' }}>{t('الأقرب', 'Nearest', 'Plus proche')}</span>}
          {left !== null && <span style={S.pill}>{left}s</span>}
        </span>
      </div>
      <div style={S.muted}>{t('ربحك الصافي', 'Your net earnings', 'Vos gains nets')}{typeof ride.pickupDistanceKm === 'number' ? ` · ${ride.pickupDistanceKm.toFixed(1)} km ${t('عن الراكب', 'to pickup', 'du client')}` : ''}</div>
      <Route ride={ride} />
      <div style={{ ...S.muted, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {typeof ride.metadata.distanceKm === 'number' && <span dir="ltr">{ride.metadata.distanceKm} km{typeof ride.metadata.estimatedMinutes === 'number' ? ` · ${ride.metadata.estimatedMinutes} min` : ''} {t('الرحلة', 'trip', 'course')}</span>}
        <span>{bagsLine(ride)}</span>
      </div>
      {msg && <p style={S.note}>{msg}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {ride.offeredToYou && <button style={S.secondary} disabled={busy} onClick={() => void decline()}>{t('رفض', 'Decline', 'Refuser')}</button>}
        <button style={{ ...S.primary, flex: 1, marginTop: 0 }} disabled={busy} onClick={() => void accept()}>{t('قبول', 'Accept', 'Accepter')}</button>
      </div>
    </div>
  )
}

function bagsLine(ride: PlatformRideRequest) {
  const b = (ride.metadata as { bags?: { large?: number; hand?: number } }).bags
  const large = Number(b?.large) || 0
  const hand = Number(b?.hand) || 0
  if (!large && !hand) return 'No bags'
  return [large ? `${large} large` : '', hand ? `${hand} hand` : ''].filter(Boolean).join(', ')
}

/** Key code to start work. Every document must be approved first; the code is issued by the Rezekme team. */
function StartWork({ lang, base, onChanged }: { lang: Lang; base: DriverBase | null; onChanged: () => void }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const blockers = base?.dutyBlockers ?? []
  async function start() {
    setBusy(true)
    setMsg('')
    try {
      await verifyKeyCode(code.trim())
      onChanged()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not start work')
    } finally {
      setBusy(false)
    }
  }
  if (!base) return <p style={S.muted}>…</p>
  return (
    <div style={S.card}>
      <strong style={{ fontSize: 18 }}>{t('ابدأ العمل', 'Start work', 'Commencer à travailler')}</strong>
      {blockers.length > 0 ? (
        <>
          <p style={S.note}>{blockers.length} {t('مستندات تحتاج انتباهك قبل أن تبدأ.', 'documents need your attention before you can start.', 'documents demandent votre attention avant de commencer.')}</p>
          <a style={{ ...S.primary, display: 'block', textAlign: 'center', textDecoration: 'none' }} href="#/driver/apply">{t('أكمل طلبك', 'Finish your application', 'Terminer votre demande')}</a>
        </>
      ) : !base.hasKeyCode ? (
        <p style={S.muted}>{t('كل شيء معتمد. سيرسل لك فريق Rezekme رمز البدء.', 'Everything is approved. The Rezekme team will give you your key code.', 'Tout est approuvé. L’équipe Rezekme vous donnera votre code.')}</p>
      ) : (
        <>
          <div style={S.muted}>{t('أدخل رمز البدء المكوّن من 6 أرقام.', 'Enter your 6-digit key code.', 'Entrez votre code à 6 chiffres.')}</div>
          <input style={S.input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          {msg && <p style={S.note}>{msg}</p>}
          <button style={S.primary} disabled={busy || code.length !== 6} onClick={() => void start()}>{t('ابدأ', 'Start work', 'Commencer')}</button>
        </>
      )}
    </div>
  )
}

function Route({ ride }: { ride: PlatformRideRequest }) {
  return (
    <div dir="ltr" style={{ margin: '10px 0', display: 'grid', gap: 6, fontSize: 15 }}>
      <div>↑ {String(ride.metadata.pickup || '-')}</div>
      <div>↓ {String(ride.metadata.dropoff || '-')}</div>
    </div>
  )
}

/* --------------------------------------------------------------------- trip */

/* Slide to confirm: avoids accidental taps (Uber-style). Enter/Space also confirms for keyboards. */
function SlideButton({ label, disabled, onDone }: { label: string; disabled?: boolean; onDone: () => void }) {
  const track = useRef<HTMLDivElement>(null)
  const [x, setX] = useState(0)
  const drag = useRef<{ startX: number; max: number } | null>(null)
  const KNOB = 56

  function down(e: React.PointerEvent) {
    if (disabled) return
    const w = track.current?.clientWidth ?? 300
    drag.current = { startX: e.clientX - x, max: w - KNOB - 8 }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function move(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    setX(Math.min(d.max, Math.max(0, e.clientX - d.startX)))
  }
  function up() {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (x >= d.max * 0.85) {
      setX(0)
      onDone()
    } else setX(0)
  }
  return (
    <div ref={track} style={{ position: 'relative', height: 64, borderRadius: 32, background: disabled ? '#999' : '#000', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 17, userSelect: 'none', touchAction: 'none' }}>
      <span style={{ opacity: Math.max(0.25, 1 - x / 160), paddingInlineStart: KNOB }}>{label}</span>
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onDone() } }}
        style={{ position: 'absolute', insetInlineStart: 4, top: 4, width: KNOB, height: KNOB, borderRadius: '50%', background: '#fff', color: '#000', display: 'grid', placeItems: 'center', fontSize: 24, transform: `translateX(${x}px)`, transition: drag.current ? 'none' : 'transform .2s', cursor: disabled ? 'default' : 'grab' }}
      >
        ➜
      </div>
    </div>
  )
}

function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function Trip({ lang, ride, rate, onChanged, onCompleted }: {
  lang: Lang
  ride: PlatformRideRequest
  rate: number
  onChanged: () => void
  onCompleted: (fare: number, currency: string) => void
}) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [pin, setPin] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [secs, setSecs] = useState<number | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMsgs, setChatMsgs] = useState<PlatformMessage[]>([])
  const [chatText, setChatText] = useState('')
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [sosArm, setSosArm] = useState(false)
  const [sosState, setSosState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const verified = typeof ride.metadata.pickupVerifiedAt === 'string'
  const toDropoff = ride.status === 'IN_PROGRESS'
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null)
  const [gpsDenied, setGpsDenied] = useState(false)
  const [lastFixAt, setLastFixAt] = useState<number>(Date.now())
  const [nowTick, setNowTick] = useState<number>(Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 5000)
    return () => window.clearInterval(id)
  }, [])
  const gpsLost = nowTick - lastFixAt > 30_000

  // Route starts at the driver (rounded to ~100 m so a moving car does not re-request the route on every GPS fix).
  const routeFrom = me ? { lat: Math.round(me.lat * 1000) / 1000, lng: Math.round(me.lng * 1000) / 1000 } : null

  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (p) => { setGpsDenied(false); setLastFixAt(Date.now()); setMe({ lat: p.coords.latitude, lng: p.coords.longitude }) },
      () => setGpsDenied(true),
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  useEffect(() => {
    if (!ride.wait) {
      setSecs(null)
      return
    }
    const end = new Date(ride.wait.waitEndsAt).getTime()
    const tick = () => setSecs(Math.max(0, Math.round((end - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [ride.wait])

  useEffect(() => {
    let cancelled = false
    const poll = () => fetchPrototypeSrRideThread(ride.id, true).then((th) => { if (!cancelled) setChatMsgs(th.messages) }).catch(() => {})
    poll()
    const id = window.setInterval(poll, 5000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [ride.id])

  async function sendChat() {
    const body = chatText.trim()
    if (!body) return
    setChatText('')
    try {
      const m = await sendPrototypeSrRideMessage(ride.id, body, true)
      setChatMsgs((prev) => [...prev, m])
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    }
  }

  function sendSos() {
    setSosState('sending')
    const go = async (c: { lat?: number; lng?: number }) => {
      try { await triggerSrSos(ride.id, c, true); setSosState('sent') } catch { setSosState('error') }
    }
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => void go({ lat: p.coords.latitude, lng: p.coords.longitude }), () => void go({}), { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 })
    else void go({})
  }

  const refreshRef = useRef(onChanged)
  refreshRef.current = onChanged

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true)
    setMsg('')
    try {
      await fn()
      after?.()
      refreshRef.current()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const title =
    ride.status === 'DRIVER_ASSIGNED'
      ? t('توجّه إلى الراكب', 'Head to the rider', 'Allez vers le client')
      : ride.status === 'DRIVER_ARRIVING'
        ? verified ? t('تم التأكد من الرمز', 'Code confirmed', 'Code confirmé') : t('بانتظار الراكب', 'Waiting for the rider', 'En attente du client')
        : t('الرحلة جارية', 'Trip in progress', 'Course en cours')

  return (
    <>
      {(() => {
        const target = toDropoff ? ride.dropoffCoords : ride.pickupCoords
        const from = me
        if (!target || !from) return null
        const km = distKm(from, target)
        const mins = Math.max(1, Math.round((km / 30) * 60))
        return (
          <div style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#000', color: '#fff', border: 0 }}>
            <strong style={{ fontSize: 22 }}>{mins} {t('د', 'min', 'min')}</strong>
            <span>{km.toFixed(1)} km · {toDropoff ? t('إلى الوجهة', 'to destination', 'vers la destination') : t('إلى الراكب', 'to pickup', 'vers le client')}</span>
          </div>
        )
      })()}
      {(gpsDenied || !me || gpsLost) && (
        <p style={S.note}>{t('شغّل الموقع (GPS) ليتبع الخريطة موقعك ويراك الراكب.', 'GPS signal lost. Turn on location: your route is recorded for everyone’s safety.', 'Activez la localisation (GPS) pour que la carte vous suive et que le client vous voie.')}</p>
      )}
      <MapHero
        lang={lang}
        pickup={ride.pickupCoords ?? null}
        dropoff={ride.dropoffCoords ?? null}
        route={routeFrom && (toDropoff ? ride.dropoffCoords : ride.pickupCoords) ? [routeFrom, (toDropoff ? ride.dropoffCoords : ride.pickupCoords) as { lat: number; lng: number }] : null}
        driver={me}
        phase={toDropoff ? 'trip' : 'approach'}
        banner={toDropoff ? t('في الطريق إلى الوجهة', 'On the way to the destination', 'En route vers la destination') : t('في الطريق إلى الراكب', 'On the way to the rider', 'En route vers le client')}
        height="46vh"
        labels={{
          show: t('عرض الخريطة', 'Show map', 'Afficher la carte'),
          hide: t('إخفاء الخريطة', 'Hide map', 'Masquer la carte'),
          recenter: t('إعادة التمركز', 'Recenter', 'Recentrer'),
          loading: t('جار تحميل الخريطة…', 'Loading map…', 'Chargement de la carte…'),
        }}
      />

      <div style={S.card}>
        <div style={S.row}>
          <div>
            <strong style={{ fontSize: 18 }}>{ride.rider?.displayName || t('الراكب', 'Rider', 'Client')}</strong>
            <div style={S.muted}>{t('مدفوع بالبطاقة. لا نقد.', 'Paid by card. No cash.', 'Payé par carte. Pas d’espèces.')}</div>
          </div>
          <span style={{ ...S.pill, width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: '50%', fontWeight: 700 }}>
            {(ride.rider?.displayName || '?').trim().charAt(0).toUpperCase()}
          </span>
        </div>
        {(() => {
          const b = ride.metadata.bags as { large?: number; hand?: number } | undefined
          return b && (b.large || b.hand) ? (
            <div style={S.muted}>🧳 {b.large ?? 0} {t('كبيرة', 'large', 'grandes')}, {b.hand ?? 0} {t('يدوية', 'hand', 'à main')}</div>
          ) : null
        })()}
      </div>

      <div style={S.card}>
        <div style={S.row}>
          <strong style={{ fontSize: 20 }}>{title}</strong>
          <span style={S.pill}>{money((ride.fareMinor ?? 0) * (1 - rate), ride.currency)}</span>
        </div>
        <Route ride={ride} />
        <a style={S.navBtn} href={navUrl(ride, toDropoff)} target="_blank" rel="noreferrer">
          🧭 {toDropoff ? t('الملاحة إلى الوجهة', 'Navigate to drop-off', 'Naviguer vers la destination') : t('الملاحة إلى الراكب', 'Navigate to pickup', 'Naviguer vers le client')}
        </a>
      </div>

      {ride.status === 'DRIVER_ASSIGNED' && (
        <SlideButton disabled={busy} label={t('اسحب: وصلت', 'Slide: I’ve arrived', 'Glisser : je suis arrivé')} onDone={() => void run(() => markDriverArrived(ride.id))} />
      )}

      {ride.status === 'DRIVER_ARRIVING' && !verified && (
        <div style={S.card}>
          {secs !== null && <div style={S.muted}>{t('مهلة الانتظار', 'Waiting time left', 'Attente restante')}: {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</div>}
          <label style={S.label}>{t('رمز الاستلام من الراكب', 'Pickup code from the rider', 'Code de prise en charge du client')}</label>
          <input style={{ ...S.input, fontSize: 28, letterSpacing: 8, textAlign: 'center' }} inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          <button style={S.primary} disabled={busy || pin.length !== 4} onClick={() => void run(() => verifySrPickup(ride.id, pin), () => setPin(''))}>
            {t('تحقق', 'Verify code', 'Vérifier')}
          </button>
          {ride.wait?.waitExpired && (
            <button style={S.secondary} disabled={busy} onClick={() => void run(() => markRiderNoShow(ride.id))}>
              {t('الراكب لم يحضر', 'Rider did not show up', 'Client absent')}
            </button>
          )}
        </div>
      )}

      {ride.status === 'DRIVER_ARRIVING' && verified && (
        <SlideButton disabled={busy} label={t('اسحب لبدء الرحلة', 'Slide to start trip', 'Glisser pour démarrer')} onDone={() => void run(() => updatePrototypeDriverRideStatus(ride.id, 'IN_PROGRESS'))} />
      )}

      {ride.status === 'IN_PROGRESS' && (
        <SlideButton disabled={busy} label={t('اسحب لإنهاء الرحلة', 'Slide to complete trip', 'Glisser pour terminer')} onDone={() => void run(() => updatePrototypeDriverRideStatus(ride.id, 'COMPLETED'), () => onCompleted(ride.fareMinor ?? 0, ride.currency))} />
      )}

      {msg && <p style={S.note}>{msg}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button style={{ ...S.secondary, flex: 1 }} onClick={() => setChatOpen((v) => !v)}>💬 {t('راسل الراكب', 'Message rider', 'Écrire au client')}{chatMsgs.length ? ` (${chatMsgs.length})` : ''}</button>
        <button style={{ ...S.secondary, flex: 1 }} onClick={() => setSafetyOpen((v) => !v)}>🛡️ {t('السلامة', 'Safety', 'Sécurité')}</button>
      </div>

      {chatOpen && (
        <div style={S.card}>
          {chatMsgs.length === 0 && <div style={S.muted}>{t('لا توجد رسائل بعد.', 'No messages yet.', 'Aucun message pour l’instant.')}</div>}
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {chatMsgs.map((m) => (
              <div key={m.id} style={{ alignSelf: m.senderRole === 'DRIVER' ? 'flex-end' : 'flex-start', background: m.senderRole === 'DRIVER' ? '#000' : '#eee', color: m.senderRole === 'DRIVER' ? '#fff' : '#000', borderRadius: 12, padding: '6px 10px', maxWidth: '80%' }}>{m.body}</div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...S.input, flex: 1 }} value={chatText} placeholder={t('اكتب رسالة...', 'Type a message...', 'Écrivez un message...')} onChange={(e) => setChatText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void sendChat() }} />
            <button style={{ ...S.secondary, width: 'auto', padding: '0 16px' }} onClick={() => void sendChat()}>{t('إرسال', 'Send', 'Envoyer')}</button>
          </div>
        </div>
      )}

      {safetyOpen && (
        <div style={S.card}>
          <strong>{t('السلامة', 'Safety', 'Sécurité')}</strong>
          <RecordingControls rideId={ride.id} lang={lang} />
          {sosState === 'sent' ? (
            <p style={S.note}>{t('تم إرسال تنبيه الطوارئ إلى الدعم.', 'Emergency alert sent to support.', 'Alerte envoyée au support.')}</p>
          ) : sosArm ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={S.secondary} onClick={() => setSosArm(false)}>{t('تراجع', 'Cancel', 'Annuler')}</button>
              <button style={{ ...S.secondary, color: '#fff', background: '#b00020', borderColor: '#b00020' }} disabled={sosState === 'sending'} onClick={sendSos}>{t('تأكيد الطوارئ', 'Confirm emergency', 'Confirmer l’urgence')}</button>
            </div>
          ) : (
            <button style={{ ...S.secondary, color: '#b00020', borderColor: '#b00020' }} onClick={() => setSosArm(true)}>🚨 {t('طوارئ SOS', 'Emergency SOS', 'Urgence SOS')}</button>
          )}
          {sosState === 'error' && <p style={S.note}>{t('فشل الإرسال', 'Could not send. Try again.', 'Échec. Réessayez.')}</p>}
        </div>
      )}

      {ride.status !== 'IN_PROGRESS' && (
        confirmCancel ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.secondary} onClick={() => setConfirmCancel(false)}>{t('تراجع', 'Keep ride', 'Garder')}</button>
            <button style={{ ...S.secondary, color: '#b00020', borderColor: '#b00020' }} disabled={busy} onClick={() => void run(() => updatePrototypeDriverRideStatus(ride.id, 'CANCELLED'))}>
              {t('تأكيد الإلغاء', 'Confirm cancel', 'Confirmer l’annulation')}
            </button>
          </div>
        ) : (
          <button style={S.link} onClick={() => setConfirmCancel(true)}>{t('إلغاء الرحلة', 'Cancel ride', 'Annuler la course')}</button>
        )
      )}
    </>
  )
}

/* ----------------------------------------------------------------- earnings */

function Earnings({ lang, overview, rate, currency }: { lang: Lang; overview: PlatformDriverOverview; rate: number; currency: string }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const recent = overview.rides.filter((r) => r.status === 'COMPLETED').slice(0, 5)
  const [openRoute, setOpenRoute] = useState<string | null>(null)
  return (
    <div style={S.card}>
      <div style={S.row}>
        <strong>{t('أرباحك', 'Your earnings', 'Vos gains')}</strong>
        <strong style={{ fontSize: 22 }}>{money(overview.totals.earningsMinor, currency)}</strong>
      </div>
      <div style={S.muted}>{t('رحلات مكتملة', overview.totals.completed === 1 ? 'completed trip' : 'completed trips', 'courses terminées')}: {overview.totals.completed}</div>
      {recent.map((r) => (
        <div key={r.id} style={{ borderTop: '1px solid #eee', paddingTop: 8, marginTop: 8, fontSize: 14 }}>
          <div style={S.row}>
            <span dir="ltr">{String(r.metadata.dropoff || '-')}</span>
            <strong>{money((r.fareMinor ?? 0) * (1 - rate), r.currency)}</strong>
          </div>
          <button style={S.link} onClick={() => setOpenRoute(openRoute === r.id ? null : r.id)}>{t('المسار المسجّل', 'Recorded route', 'Trajet enregistré')}</button>
          {openRoute === r.id && <RouteViewer rideId={r.id} lang={lang} asDriver />}
        </div>
      ))}
      <PayoutBox lang={lang} currency={currency} />
    </div>
  )
}

/** Balance the driver can withdraw, a request form (paid by the operator outside the platform) and the request history. */
function PayoutBox({ lang, currency }: { lang: Lang; currency: string }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [info, setInfo] = useState<Awaited<ReturnType<typeof fetchPayouts>> | null>(null)
  const [amount, setAmount] = useState('')
  const [wallet, setWallet] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => { fetchPayouts(currency).then(setInfo).catch(() => setInfo(null)) }, [currency])
  useEffect(() => { load() }, [load])
  if (!info) return null
  const free = Math.max(0, info.availableMinor - info.pendingMinor)
  const submit = async () => {
    const minor = Math.round(Number(amount))
    if (!Number.isInteger(minor) || minor <= 0 || minor > free) { setMsg(t('أدخل مبلغاً صحيحاً لا يتجاوز رصيدك', 'Enter a valid amount up to your balance', 'Entrez un montant valide, au plus votre solde')); return }
    if (!wallet.trim() || !name.trim()) { setMsg(t('أدخل اسمك ورقم محفظة شام كاش', 'Enter your name and Sham Cash wallet number', 'Entrez votre nom et le numéro Sham Cash')); return }
    setBusy(true); setMsg('')
    try {
      await requestPayout(minor, currency, { type: 'sham_cash', accountName: name.trim(), walletNumber: wallet.trim() })
      setAmount(''); setMsg(t('تم إرسال الطلب، سيتم الدفع بعد مراجعة الإدارة', 'Request sent. The admin pays it after review.', 'Demande envoyée. Elle sera payée après vérification.'))
      load()
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div style={{ borderTop: '1px solid #eee', paddingTop: 10, marginTop: 10, display: 'grid', gap: 8 }}>
      <div style={S.row}>
        <strong>{t('الرصيد المتاح للسحب', 'Available to withdraw', 'Disponible au retrait')}</strong>
        <strong>{money(free, currency)}</strong>
      </div>
      {info.pendingMinor > 0 && <div style={S.muted}>{t('قيد الطلب', 'Pending request', 'En attente')}: {money(info.pendingMinor, currency)}</div>}
      {free > 0 && (
        <>
          <input style={S.input} inputMode="numeric" placeholder={t('المبلغ', 'Amount', 'Montant')} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input style={S.input} placeholder={t('الاسم على المحفظة', 'Name on the wallet', 'Nom sur le portefeuille')} value={name} onChange={(e) => setName(e.target.value)} />
          <input style={S.input} inputMode="tel" placeholder={t('رقم محفظة شام كاش', 'Sham Cash wallet number', 'Numéro Sham Cash')} value={wallet} onChange={(e) => setWallet(e.target.value)} />
          <button style={S.primary} disabled={busy} onClick={submit}>{t('اطلب السحب', 'Request payout', 'Demander le retrait')}</button>
        </>
      )}
      {msg && <div style={S.muted}>{msg}</div>}
      {info.requests.slice(0, 5).map((r) => (
        <div key={r.id} style={{ ...S.row, fontSize: 14 }}>
          <span>{money(r.amountMinor, r.currency)} · {r.status === 'PAID' ? t('مدفوع', 'Paid', 'Payé') : r.status === 'REJECTED' ? t('مرفوض', 'Rejected', 'Refusé') : t('قيد المراجعة', 'In review', 'En revue')}</span>
          <span style={S.muted} dir="ltr">{r.reference || ''}</span>
        </div>
      ))}
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  page: { maxWidth: 520, margin: '0 auto', padding: '16px 16px 48px', display: 'grid', gap: 12, alignContent: 'start' },
  h1: { fontSize: 24, margin: '4px 0 0' },
  muted: { color: '#666', fontSize: 14 },
  note: { background: '#fff4e0', border: '1px solid #f0d49a', borderRadius: 10, padding: '10px 12px', fontSize: 14, margin: 0 },
  label: { fontSize: 13, fontWeight: 700, marginBottom: -6 },
  input: { width: '100%', boxSizing: 'border-box', minHeight: 48, borderRadius: 12, border: '1px solid #ccc', padding: '0 14px', fontSize: 16, background: '#fff', color: '#000' },
  primary: { width: '100%', minHeight: 56, borderRadius: 14, border: 0, background: '#000', color: '#fff', fontSize: 17, fontWeight: 700, cursor: 'pointer', marginTop: 4 },
  onlineOn: { width: '100%', minHeight: 56, borderRadius: 14, border: 0, background: '#0a7a3b', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  secondary: { minHeight: 48, borderRadius: 12, border: '1px solid #000', background: '#fff', color: '#000', fontSize: 15, fontWeight: 700, padding: '0 16px', cursor: 'pointer' },
  link: { background: 'none', border: 0, color: '#555', textDecoration: 'underline', fontSize: 14, cursor: 'pointer', padding: 8 },
  card: { border: '1px solid #e2e2e2', borderRadius: 16, padding: 14, background: '#fff', display: 'grid', gap: 6 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pill: { borderRadius: 999, background: '#f1f1f1', padding: '4px 10px', fontSize: 13, fontWeight: 700 },
  navBtn: { display: 'block', textAlign: 'center', textDecoration: 'none', minHeight: 48, lineHeight: '48px', borderRadius: 12, background: '#1a73e8', color: '#fff', fontWeight: 700, fontSize: 16 },
}
