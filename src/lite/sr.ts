import { api, ApiError, applyLang, banner, clearSession, getLang, getSession, h, langToggle, money, mount, registerShell, setSession, store, type Lang, type Session } from './lite'

// LIGHT SR (rides): sign in -> from/to -> price -> request -> live status. No maps, no video.
const T = {
  ar: {
    title: 'سير', email: 'البريد الإلكتروني', password: 'كلمة المرور', signin: 'دخول', create: 'إنشاء حساب',
    haveAcc: 'لدي حساب', name: 'الاسم', sendCode: 'إرسال الرمز', code: 'الرمز المرسل إلى بريدك',
    from: 'من أين؟', to: 'إلى أين؟', myLoc: 'موقعي', type: 'نوع الرحلة', price: 'اعرف السعر', request: 'اطلب الرحلة',
    est: 'السعر التقريبي', min: 'دقيقة', cancel: 'إلغاء الرحلة', newRide: 'رحلة جديدة', signout: 'خروج',
    offline: 'لا يوجد اتصال. حاول مرة أخرى.', fill: 'اكتب نقطة الانطلاق والوجهة.', pickupCode: 'رمز الركوب (أعطه للسائق): ',
    driver: 'السائق', waiting: 'جاري البحث عن سائق…', fare: 'الأجرة', locFail: 'تعذر تحديد الموقع، اكتبه يدويًا.', sent: 'تم الإرسال. تحقق من بريدك.',
    cats: { 'SR Bike': 'دراجة', 'SR Economy': 'اقتصادي', 'SR Comfort': 'مريح', 'SR SUV': 'عائلي', 'SR Van': 'فان', 'SR VIP': 'VIP فاخر' } as Record<string, string>,
    st: { DRAFT: 'مجدولة', REQUESTED: 'تم إرسال الطلب', MATCHING: 'جاري البحث عن سائق…', DRIVER_ASSIGNED: 'السائق في الطريق', DRIVER_ARRIVING: 'السائق وصل تقريبًا', IN_PROGRESS: 'الرحلة جارية', COMPLETED: 'اكتملت الرحلة', CANCELLED: 'أُلغيت الرحلة' } as Record<string, string>,
  },
  en: {
    title: 'SR Rides', email: 'Email', password: 'Password', signin: 'Sign in', create: 'Create account',
    haveAcc: 'I have an account', name: 'Name', sendCode: 'Send code', code: 'Code sent to your email',
    from: 'Pickup', to: 'Where to?', myLoc: 'My location', type: 'Ride type', price: 'Get price', request: 'Request ride',
    est: 'Estimated fare', min: 'min', cancel: 'Cancel ride', newRide: 'New ride', signout: 'Sign out',
    offline: 'No connection. Please try again.', fill: 'Enter pickup and destination.', pickupCode: 'Pickup code (tell the driver): ',
    driver: 'Driver', waiting: 'Finding a driver…', fare: 'Fare', locFail: 'Could not get location, type it instead.', sent: 'Sent. Check your email.',
    cats: { 'SR Bike': 'Bike', 'SR Economy': 'Economy', 'SR Comfort': 'Comfort', 'SR SUV': 'SUV', 'SR Van': 'Van', 'SR VIP': 'VIP' } as Record<string, string>,
    st: { DRAFT: 'Scheduled', REQUESTED: 'Request sent', MATCHING: 'Finding a driver…', DRIVER_ASSIGNED: 'Driver on the way', DRIVER_ARRIVING: 'Driver arriving', IN_PROGRESS: 'Trip in progress', COMPLETED: 'Trip complete', CANCELLED: 'Trip cancelled' } as Record<string, string>,
  },
}
const CATS = ['SR Economy', 'SR Bike', 'SR Comfort', 'SR SUV', 'SR Van', 'SR VIP']
const ACTIVE = ['DRAFT', 'REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
const CANCELLABLE = ['DRAFT', 'REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING']
const RIDE_KEY = 'sybnb.lite.sr.rideId'

type Ride = { id: string; status: string; fareMinor: number | null; currency: string; etaToPickupMinutes?: number | null; driver?: { displayName?: string } | null; metadata?: { pickupCode?: string } }
type Quote = { fareMinor: number; currency?: string; estimatedMinutes?: number }

const root = document.getElementById('app')!
let lang: Lang = getLang()
let pollTimer: number | undefined
const form = { pickup: '', dropoff: '', category: 'SR Economy', coords: undefined as undefined | { lat: number; lng: number }, accuracy: undefined as undefined | number }
const none = null as unknown as Node

function errText(e: unknown) {
  return e instanceof ApiError && !e.offline ? e.message : T[lang].offline
}

function render() {
  applyLang(lang)
  window.clearTimeout(pollTimer)
  const session = getSession()
  const head = h('header', {}, h('h1', {}, T[lang].title), h('span', {}, langToggle(lang, () => { lang = lang === 'ar' ? 'en' : 'ar'; render() }),
    session ? h('button', { class: 'link', type: 'button', onclick: () => { clearSession(); store(RIDE_KEY, null); render() } }, T[lang].signout) : null))
  if (!session) return mount(root, head, authView())
  const rideId = store(RIDE_KEY)
  mount(root, head, rideId ? rideView(rideId) : requestView())
}

function field(label: string, input: HTMLInputElement | HTMLSelectElement) {
  return h('label', {}, label, input)
}

// ---------- sign in / create account (account creation needs the emailed code) ----------
function authView() {
  const t = T[lang]
  let creating = false
  const box = h('main', {})
  const draw = (note?: Node, step: 'form' | 'code' = 'form', keep?: { email: string; name: string }) => {
    const email = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', required: true, value: keep?.email || '' })
    const pass = h('input', { type: 'password', autocomplete: creating ? 'new-password' : 'current-password', required: true, minlength: '8' })
    const name = h('input', { type: 'text', autocomplete: 'name', value: keep?.name || '' })
    const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '8' })
    const go = h('button', { type: 'submit', class: 'primary' }, creating ? (step === 'code' ? t.create : t.sendCode) : t.signin)
    const f = h('form', {
      onsubmit: async (ev: Event) => {
        ev.preventDefault()
        go.setAttribute('disabled', '')
        const em = email.value.trim()
        try {
          if (!creating) {
            const r = await api<Session>('/api/auth/login', { method: 'POST', body: { email: em, password: pass.value } })
            setSession({ token: r.token, user: r.user }); return render()
          }
          if (step === 'form') {
            await api('/api/otp/send', { method: 'POST', body: { email: em, purpose: 'account-verify' } })
            return draw(banner(t.sent, 'info'), 'code', { email: em, name: name.value })
          }
          const v = await api<{ verified: boolean }>('/api/otp/verify', { method: 'POST', body: { email: em, purpose: 'account-verify', code: code.value.trim() } })
          if (!v.verified) throw new ApiError('Invalid code')
          const r = await api<Session>('/api/auth/register', { method: 'POST', body: { email: em, password: pass.value, displayName: name.value.trim() || em, role: 'GUEST' } })
          setSession({ token: r.token, user: r.user }); render()
        } catch (e) {
          draw(banner(errText(e)), step, { email: em, name: name.value })
        }
      },
    },
      creating ? field(t.name, name) : null,
      field(t.email, email),
      field(t.password, pass),
      creating && step === 'code' ? field(t.code, code) : null,
      go)
    const toggle = h('button', { class: 'link', type: 'button', onclick: () => { creating = !creating; draw() } }, creating ? t.haveAcc : t.create)
    mount(box, ...(note ? [note] : []), f, toggle)
  }
  draw()
  return box
}

// ---------- request a ride ----------
function requestView() {
  const t = T[lang]
  const from = h('input', { type: 'text', value: form.pickup, autocomplete: 'off', oninput: (e: Event) => { form.pickup = (e.target as HTMLInputElement).value; form.coords = undefined } })
  const to = h('input', { type: 'text', value: form.dropoff, autocomplete: 'off', oninput: (e: Event) => { form.dropoff = (e.target as HTMLInputElement).value } })
  const cat = h('select', { onchange: (e: Event) => { form.category = (e.target as HTMLSelectElement).value } },
    ...CATS.map((c) => h('option', { value: c, ...(c === form.category ? { selected: true } : {}) }, t.cats[c])))
  const out = h('div', {})
  const say = (n: Node) => mount(out, n)
  const locate = h('button', {
    class: 'link', type: 'button',
    onclick: () => {
      if (!navigator.geolocation) return say(banner(t.locFail))
      navigator.geolocation.getCurrentPosition((p) => {
        form.coords = { lat: p.coords.latitude, lng: p.coords.longitude }; form.accuracy = p.coords.accuracy
        form.pickup = t.myLoc; from.value = t.myLoc
      }, () => say(banner(t.locFail)), { enableHighAccuracy: true, timeout: 12000 })
    },
  }, t.myLoc)
  const body = () => ({ pickup: form.pickup.trim(), dropoff: form.dropoff.trim(), category: form.category, lowDataMode: true, ...(form.coords ? { pickupCoords: form.coords } : {}) })
  const priceBtn = h('button', { type: 'button', class: 'primary', onclick: async () => {
    if (!form.pickup.trim() || !form.dropoff.trim()) return say(banner(t.fill))
    priceBtn.setAttribute('disabled', '')
    try {
      const r = await api<{ quote: Quote }>('/api/sr/quote', { method: 'POST', auth: true, body: body() })
      const q = r.quote
      const cur = q.currency || 'USD'
      const go = h('button', { type: 'button', class: 'primary', onclick: async () => {
        go.setAttribute('disabled', '')
        try {
          const created = await api<{ ride: Ride }>('/api/sr/rides', { method: 'POST', auth: true, body: { ...body(), currency: cur, ...(form.accuracy ? { accuracyMeters: form.accuracy } : {}) } })
          store(RIDE_KEY, created.ride.id); render()
        } catch (e) { go.removeAttribute('disabled'); say(banner(errText(e))) }
      } }, t.request)
      mount(out,
        h('p', { class: 'big' }, `${t.est}: ${money(q.fareMinor, cur)}`),
        q.estimatedMinutes ? h('p', {}, `≈ ${q.estimatedMinutes} ${t.min}`) : none,
        go)
    } catch (e) { say(banner(errText(e))) } finally { priceBtn.removeAttribute('disabled') }
  } }, t.price)
  return h('main', {}, field(t.from, from), locate, field(t.to, to), field(t.type, cat), priceBtn, out)
}

// ---------- live ride (polls gently; backs off on a bad connection; pauses when hidden) ----------
function rideView(rideId: string) {
  const t = T[lang]
  const box = h('main', {}, h('p', { class: 'big' }, t.waiting))
  let delay = 6000
  const draw = (r: Ride, note?: Node) => {
    const done = !ACTIVE.includes(r.status)
    mount(box,
      ...(note ? [note] : []),
      h('p', { class: 'big' }, t.st[r.status] || r.status),
      r.etaToPickupMinutes ? h('p', {}, `≈ ${r.etaToPickupMinutes} ${t.min}`) : none,
      r.driver?.displayName ? h('p', {}, `${t.driver}: ${r.driver.displayName}`) : none,
      r.fareMinor != null ? h('p', {}, `${t.fare}: ${money(r.fareMinor, r.currency || 'USD')}`) : none,
      r.metadata?.pickupCode && !done ? h('p', {}, t.pickupCode, h('b', { class: 'code' }, r.metadata.pickupCode)) : none,
      CANCELLABLE.includes(r.status) ? h('button', { type: 'button', onclick: async () => {
        try { await api(`/api/sr/rides/${rideId}/cancel`, { method: 'PATCH', auth: true }); await poll() } catch (e) { draw(r, banner(errText(e))) }
      } }, t.cancel) : none,
      done ? h('button', { type: 'button', class: 'primary', onclick: () => { store(RIDE_KEY, null); render() } }, t.newRide) : none)
  }
  const poll = async (): Promise<void> => {
    if (!document.body.contains(box)) return
    try {
      const r = await api<{ ride: Ride }>(`/api/sr/rides/${rideId}`, { auth: true })
      draw(r.ride)
      delay = 6000
      if (!ACTIVE.includes(r.ride.status)) return
    } catch (e) {
      if (e instanceof ApiError && !e.offline && (e.status === 404 || e.status === 401)) { store(RIDE_KEY, null); return render() }
      delay = Math.min(delay * 2, 60000)
      mount(box, banner(t.offline), h('p', { class: 'big' }, t.waiting))
    }
    pollTimer = window.setTimeout(() => {
      if (document.hidden) document.addEventListener('visibilitychange', () => void poll(), { once: true })
      else void poll()
    }, delay)
  }
  // Start after the box is mounted (render() mounts it right after this returns).
  window.setTimeout(() => void poll(), 0)
  return box
}

registerShell('/sr.html')
render()
