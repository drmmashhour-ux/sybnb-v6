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
  fetchPendingSrRides,
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
  type PlatformRideRequest,
} from '@platform/shared/api/platformApi'

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
  const [online, setOnline] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ fare: number; currency: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const [o, id] = await Promise.all([fetchPrototypeDriverOverview(), fetchDriverIdentityStatus()])
      setOverview(o)
      setIdStatus(id)
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
  const ready = idApproved && vehicleOk && inspectionOk

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
    const tick = () => fetchPendingSrRides().then((r) => !stop && setPending(r)).catch(() => undefined)
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

      {!overview || idStatus === undefined ? (
        <p style={S.muted}>…</p>
      ) : !ready ? (
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
          {pending.map((ride) => (
            <Offer key={ride.id} lang={lang} ride={ride} rate={rate} onChanged={() => void load()} />
          ))}
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

function Offer({ lang, ride, rate, onChanged }: { lang: Lang; ride: PlatformRideRequest; rate: number; onChanged: () => void }) {
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
        {left !== null && <span style={S.pill}>{left}s</span>}
      </div>
      <div style={S.muted}>{t('ربحك الصافي', 'Your net earnings', 'Vos gains nets')}{typeof ride.pickupDistanceKm === 'number' ? ` · ${ride.pickupDistanceKm.toFixed(1)} km ${t('عن الراكب', 'to pickup', 'du client')}` : ''}</div>
      <Route ride={ride} />
      {msg && <p style={S.note}>{msg}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {ride.offeredToYou && <button style={S.secondary} disabled={busy} onClick={() => void decline()}>{t('رفض', 'Decline', 'Refuser')}</button>}
        <button style={{ ...S.primary, flex: 1, marginTop: 0 }} disabled={busy} onClick={() => void accept()}>{t('قبول', 'Accept', 'Accepter')}</button>
      </div>
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

  const verified = typeof ride.metadata.pickupVerifiedAt === 'string'

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

  const toDropoff = ride.status === 'IN_PROGRESS'
  const title =
    ride.status === 'DRIVER_ASSIGNED'
      ? t('توجّه إلى الراكب', 'Head to the rider', 'Allez vers le client')
      : ride.status === 'DRIVER_ARRIVING'
        ? verified ? t('تم التأكد من الرمز', 'Code confirmed', 'Code confirmé') : t('بانتظار الراكب', 'Waiting for the rider', 'En attente du client')
        : t('الرحلة جارية', 'Trip in progress', 'Course en cours')

  return (
    <>
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
        <button style={S.primary} disabled={busy} onClick={() => void run(() => markDriverArrived(ride.id))}>
          {t('وصلت إلى نقطة الاستلام', 'I’ve arrived', 'Je suis arrivé')}
        </button>
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
        <button style={S.primary} disabled={busy} onClick={() => void run(() => updatePrototypeDriverRideStatus(ride.id, 'IN_PROGRESS'))}>
          {t('بدء الرحلة', 'Start trip', 'Démarrer la course')}
        </button>
      )}

      {ride.status === 'IN_PROGRESS' && (
        <button style={S.primary} disabled={busy} onClick={() => void run(() => updatePrototypeDriverRideStatus(ride.id, 'COMPLETED'), () => onCompleted(ride.fareMinor ?? 0, ride.currency))}>
          {t('إنهاء الرحلة', 'Complete trip', 'Terminer la course')}
        </button>
      )}

      {msg && <p style={S.note}>{msg}</p>}

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
  return (
    <div style={S.card}>
      <div style={S.row}>
        <strong>{t('أرباحك', 'Your earnings', 'Vos gains')}</strong>
        <strong style={{ fontSize: 22 }}>{money(overview.totals.earningsMinor, currency)}</strong>
      </div>
      <div style={S.muted}>{t('رحلات مكتملة', overview.totals.completed === 1 ? 'completed trip' : 'completed trips', 'courses terminées')}: {overview.totals.completed}</div>
      {recent.map((r) => (
        <div key={r.id} style={{ ...S.row, borderTop: '1px solid #eee', paddingTop: 8, marginTop: 8, fontSize: 14 }}>
          <span dir="ltr">{String(r.metadata.dropoff || '-')}</span>
          <strong>{money((r.fareMinor ?? 0) * (1 - rate), r.currency)}</strong>
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
