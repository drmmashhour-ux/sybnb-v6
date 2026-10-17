import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { EatsRatingBox } from './EatsRatingBox'
import {
  cancelFoodOrder,
  fetchFoodMenu,
  fetchFoodOrder,
  fetchFoodOrderMessages,
  fetchFoodOrderTracked,
  foodPhotoSrc,
  listFoodMerchants,
  placeFoodOrder,
  sendFoodOrderMessage,
  type FoodMenuItem,
  type FoodMerchant,
  type FoodOrder,
  type FoodOrderMessage,
  type FoodOrderTracking,
} from '@platform/shared/api/platformApi'

// What a line actually costs right now: the server sends effectivePriceMinor (promo applied when
// one is live). Display-only — the order total is always the server's own number.
function unitPrice(item: FoodMenuItem): number {
  return item.effectivePriceMinor ?? item.priceMinor
}

// Keyless Google Maps capsule (SYBNB pattern, src/shared/maps/googleMapCapsule.ts): a free embed
// iframe + a directions link with the viewer's own live travel time. No API key, no billing.
function mapEmbedUrl(query: string, lang: string) {
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&hl=${lang}&z=15&output=embed`
}
function mapDirectionsUrl(query: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`
}

function fmtClock(iso: string | null | undefined, lang: Lang) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(lang === 'ar' ? 'ar-SY' : lang === 'fr' ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit' })
}

// Ready-alert: ask once when an order goes live; fire on the transitions the customer waits for.
function notifySafe(title: string, body: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  } catch {
    /* notifications unavailable */
  }
}

// SE (Eats) Phase 2 — the customer flow, Yallago/Uber Eats-style, three screens in one page:
//   browse (approved merchants, by city) → menu + cart (quantities, server-priced) →
//   checkout (address + notes, cash on delivery) → live order card (status, refresh, cancel while
//   PLACED). Totals shown pre-order are computed from the same menu prices the server snapshots,
//   but the server's own order response is always what the customer finally sees.

type Props = { lang: Lang }

const ORDER_KEY = 'sybnb.se.activeOrderId'
const STATUS_FLOW = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED'] as const
// A pickup order has no courier leg: ready → handed to the customer.
const PICKUP_FLOW = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'DELIVERED'] as const

function money(minor: number, currency: string, lang: Lang) {
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-SY' : lang === 'fr' ? 'fr-FR' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(minor)
  } catch {
    return `${minor} ${currency}`
  }
}

export function EatsPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = useMemo(
    () => ({
      browseTitle: pick(lang, 'اطلب طعامك', 'Order food', 'Commandez à manger'),
      browseSub: pick(lang, 'مطاعم ومتاجر معتمدة، الدفع نقدًا عند التسليم.', 'Approved restaurants and stores — pay cash on delivery.', 'Restaurants et magasins approuvés — paiement à la livraison.'),
      cityFilter: pick(lang, 'المدينة (مثال: دمشق)', 'City (e.g. Damascus)', 'Ville (ex. Damas)'),
      search: pick(lang, 'بحث', 'Search', 'Chercher'),
      empty: pick(lang, 'لا توجد مطاعم معتمدة في هذه المدينة بعد.', 'No approved merchants in this city yet.', 'Aucun commerçant approuvé dans cette ville pour le moment.'),
      back: pick(lang, 'رجوع', 'Back', 'Retour'),
      menuOf: pick(lang, 'قائمة', 'Menu', 'Menu'),
      add: pick(lang, 'أضف', 'Add', 'Ajouter'),
      cart: pick(lang, 'سلة الطلب', 'Your order', 'Votre commande'),
      cartEmpty: pick(lang, 'السلة فارغة — أضف أصنافًا من القائمة.', 'Cart is empty — add items from the menu.', 'Panier vide — ajoutez des articles du menu.'),
      subtotal: pick(lang, 'المجموع الفرعي', 'Subtotal', 'Sous-total'),
      address: pick(lang, 'عنوان التوصيل', 'Delivery address', 'Adresse de livraison'),
      addressPh: pick(lang, 'مثال: المزة، بناء ٤، طابق ٢', 'e.g. Mezzeh, building 4, 2nd floor', 'ex. Mezzeh, bâtiment 4, 2e étage'),
      notes: pick(lang, 'ملاحظات (اختياري)', 'Notes (optional)', 'Notes (optionnel)'),
      placeOrder: pick(lang, 'اطلب الآن — الدفع عند التسليم', 'Place order — cash on delivery', 'Commander — paiement à la livraison'),
      placing: pick(lang, 'جارٍ إرسال الطلب…', 'Placing order…', 'Envoi de la commande…'),
      orderTitle: pick(lang, 'طلبك', 'Your order', 'Votre commande'),
      total: pick(lang, 'الإجمالي (يدفع نقدًا)', 'Total (pay in cash)', 'Total (en espèces)'),
      deliveryFee: pick(lang, 'رسوم التوصيل', 'Delivery fee', 'Frais de livraison'),
      serviceFee: pick(lang, 'رسوم الخدمة', 'Service fee', 'Frais de service'),
      refresh: pick(lang, 'تحديث الحالة', 'Refresh status', 'Actualiser'),
      cancel: pick(lang, 'إلغاء الطلب', 'Cancel order', 'Annuler la commande'),
      newOrder: pick(lang, 'طلب جديد', 'New order', 'Nouvelle commande'),
      cancelBlocked: pick(lang, 'لا يمكن الإلغاء بعد قبول المطعم للطلب.', 'Cannot cancel after the restaurant accepts.', 'Annulation impossible après acceptation.'),
      st: {
        PLACED: pick(lang, 'تم إرسال الطلب — بانتظار المطعم', 'Order sent — waiting for the restaurant', 'Commande envoyée — en attente du restaurant'),
        ACCEPTED: pick(lang, 'المطعم قبل الطلب', 'Restaurant accepted', 'Restaurant a accepté'),
        PREPARING: pick(lang, 'جارٍ تحضير طلبك', 'Preparing your order', 'Préparation en cours'),
        READY_FOR_PICKUP: pick(lang, 'جاهز — بانتظار السائق', 'Ready — waiting for a courier', 'Prêt — en attente du livreur'),
        PICKED_UP: pick(lang, 'السائق في الطريق إليك', 'Courier on the way to you', 'Livreur en route'),
        DELIVERED: pick(lang, 'تم التسليم — صحتين!', 'Delivered — enjoy!', 'Livré — bon appétit !'),
        CANCELLED: pick(lang, 'أُلغي الطلب', 'Order cancelled', 'Commande annulée'),
        REJECTED: pick(lang, 'اعتذر المطعم عن الطلب', 'The restaurant declined this order', 'Le restaurant a refusé la commande'),
      } as Record<string, string>,
      errGeneric: pick(lang, 'حدث خطأ، حاول مرة أخرى.', 'Something went wrong, try again.', 'Une erreur est survenue, réessayez.'),
      fillAddress: pick(lang, 'اكتب عنوان التوصيل.', 'Enter a delivery address.', 'Saisissez une adresse de livraison.'),
      // Order experience
      delivery: pick(lang, 'توصيل', 'Delivery', 'Livraison'),
      pickup: pick(lang, 'استلام من المطعم', 'Pickup', 'À emporter'),
      scheduleToggle: pick(lang, 'جدولة لوقت لاحق', 'Schedule for later', 'Planifier'),
      scheduleNow: pick(lang, 'اطلب الآن بدلًا من الجدولة', 'Order now instead', 'Commander maintenant'),
      scheduledForL: pick(lang, 'مجدول في', 'Scheduled for', 'Planifiée pour'),
      busyBadge: pick(lang, 'مشغول الآن', 'Busy right now', 'Occupé'),
      busyBanner: pick(lang, 'المطعم متوقف عن استقبال الطلبات الفورية حاليًا — يمكنك جدولة طلبك لوقت لاحق أو اختيار مطعم آخر.', 'This restaurant has paused instant orders — schedule for later or choose another restaurant.', 'Ce restaurant a suspendu les commandes immédiates — planifiez ou choisissez un autre restaurant.'),
      otherRestaurants: pick(lang, 'مطاعم أخرى', 'Other restaurants', 'Autres restaurants'),
      etaL: pick(lang, 'جاهز حوالي الساعة', 'Ready around', 'Prêt vers'),
      courierEtaL: pick(lang, 'السائق على بعد حوالي', 'Courier about', 'Livreur à environ'),
      minutes: pick(lang, 'دقيقة', 'min', 'min'),
      delayedBanner: pick(lang, 'المطعم أجّل طلبك — الموعد الجديد حوالي', 'The restaurant delayed your order — new time around', 'Le restaurant a retardé votre commande — nouvelle heure vers'),
      delayedChoices: pick(lang, 'يمكنك الانتظار، إلغاء الطلب، أو الطلب من مطعم آخر.', 'You can wait, cancel, or order from another restaurant.', 'Vous pouvez attendre, annuler ou commander ailleurs.'),
      iWillWait: pick(lang, 'سأنتظر', "I'll wait", "J'attends"),
      cancelAndSwitch: pick(lang, 'إلغاء واختيار مطعم آخر', 'Cancel & choose another', 'Annuler et changer'),
      pickupReady: pick(lang, 'طلبك جاهز — استلمه من المطعم', 'Your order is ready — pick it up', 'Commande prête — à récupérer'),
      directions: pick(lang, 'الاتجاهات ووقت الوصول المباشر', 'Directions & live travel time', 'Itinéraire et durée en direct'),
      mapTitle: pick(lang, 'خريطة الطلب', 'Order map', 'Carte de la commande'),
      chatTitle: pick(lang, 'محادثة الطلب', 'Order chat', 'Messages'),
      chatPlaceholder: pick(lang, 'اكتب رسالة للمطعم أو السائق…', 'Message the restaurant or courier…', 'Écrire au restaurant ou au livreur…'),
      send: pick(lang, 'إرسال', 'Send', 'Envoyer'),
      roleNames: {
        customer: pick(lang, 'أنا', 'Me', 'Moi'),
        merchant: pick(lang, 'المطعم', 'Restaurant', 'Restaurant'),
        courier: pick(lang, 'السائق', 'Courier', 'Livreur'),
        admin: pick(lang, 'الدعم', 'Support', 'Support'),
      } as Record<string, string>,
      stPickupReady: pick(lang, 'جاهز — بانتظارك في المطعم', 'Ready — waiting for you at the restaurant', 'Prêt — vous attend au restaurant'),
      notifReady: pick(lang, 'طلبك جاهز!', 'Your order is ready!', 'Votre commande est prête !'),
      notifOnTheWay: pick(lang, 'السائق في الطريق إليك', 'Courier on the way', 'Livreur en route'),
      notifDelayed: pick(lang, 'المطعم أجّل طلبك', 'Your order was delayed', 'Commande retardée'),
      notifDelivered: pick(lang, 'تم التسليم — صحتين!', 'Delivered — enjoy!', 'Livré — bon appétit !'),
    }),
    [lang],
  )

  const [merchants, setMerchants] = useState<FoodMerchant[] | null>(null)
  const [city, setCity] = useState('')
  const [merchant, setMerchant] = useState<FoodMerchant | null>(null)
  const [menu, setMenu] = useState<FoodMenuItem[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [order, setOrder] = useState<FoodOrder | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Order experience state
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>('delivery')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduledFor, setScheduledFor] = useState('')
  const [tracking, setTracking] = useState<FoodOrderTracking | null>(null)
  const [messages, setMessages] = useState<FoodOrderMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [delaySeen, setDelaySeen] = useState(0) // delayedCount the customer has acknowledged
  const prevStatusRef = useRef<string>('')
  const prevDelayRef = useRef<number>(0)

  async function loadMerchants(cityFilter?: string) {
    setError('')
    try {
      setMerchants(await listFoodMerchants(cityFilter?.trim() || undefined))
    } catch {
      setError(t.errGeneric)
      setMerchants([])
    }
  }

  useEffect(() => {
    void loadMerchants()
    // Resume a live order after a reload (per-viewer convenience only; wrapped for private mode).
    try {
      const saved = window.localStorage.getItem(ORDER_KEY)
      if (saved) fetchFoodOrder(saved).then(setOrder).catch(() => window.localStorage.removeItem(ORDER_KEY))
    } catch {
      /* storage blocked */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openMerchant(m: FoodMerchant) {
    setError('')
    setMerchant(m)
    setCart({})
    try {
      const r = await fetchFoodMenu(m.id)
      setMenu(r.items.filter((item) => item.available))
    } catch {
      setError(t.errGeneric)
      setMenu([])
    }
  }

  const cartLines = useMemo(
    () => menu.filter((item) => (cart[item.id] || 0) > 0).map((item) => ({ item, quantity: cart[item.id] })),
    [menu, cart],
  )
  const subtotal = cartLines.reduce((sum, line) => sum + unitPrice(line.item) * line.quantity, 0)
  const currency = menu[0]?.currency || 'SYP'

  function bump(itemId: string, delta: number) {
    setCart((prev) => {
      const next = Math.max(0, Math.min(20, (prev[itemId] || 0) + delta))
      return { ...prev, [itemId]: next }
    })
  }

  async function submitOrder() {
    if (!merchant) return
    if (fulfillment === 'delivery' && !address.trim()) {
      setError(t.fillAddress)
      return
    }
    setBusy(true)
    setError('')
    try {
      const placed = await placeFoodOrder({
        merchantId: merchant.id,
        deliveryAddress: address.trim(),
        notes: notes.trim() || undefined,
        items: cartLines.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity })),
        fulfillment,
        scheduledFor: scheduleOpen && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      })
      setOrder(placed)
      setDelaySeen(0)
      prevStatusRef.current = placed.status
      prevDelayRef.current = placed.delayedCount || 0
      // Ask once for the ready-alert, right when the customer has an order worth alerting about.
      try {
        if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
      } catch {
        /* notifications unavailable */
      }
      try {
        window.localStorage.setItem(ORDER_KEY, placed.id)
      } catch {
        /* storage blocked */
      }
    } catch (err) {
      setError((err as Error).message || t.errGeneric)
    } finally {
      setBusy(false)
    }
  }

  async function refreshOrder() {
    if (!order) return
    try {
      const r = await fetchFoodOrderTracked(order.id)
      applyOrderUpdate(r.order, r.tracking)
    } catch {
      setError(t.errGeneric)
    }
  }

  // One place digests every refresh: status-change + delay notifications fire here, so the
  // customer "gets to know" the moment the order is ready / on the way / delayed.
  function applyOrderUpdate(next: FoodOrder, nextTracking: FoodOrderTracking | null) {
    const prevStatus = prevStatusRef.current
    const prevDelay = prevDelayRef.current
    if (prevStatus && next.status !== prevStatus) {
      if (next.status === 'READY_FOR_PICKUP') notifySafe(t.notifReady, next.fulfillment === 'pickup' ? t.stPickupReady : t.st.READY_FOR_PICKUP)
      else if (next.status === 'PICKED_UP') notifySafe(t.notifOnTheWay, t.st.PICKED_UP)
      else if (next.status === 'DELIVERED') notifySafe(t.notifDelivered, '')
    }
    if ((next.delayedCount || 0) > prevDelay) {
      notifySafe(t.notifDelayed, `${t.delayedBanner} ${fmtClock(next.etaAt, lang)}`)
    }
    prevStatusRef.current = next.status
    prevDelayRef.current = next.delayedCount || 0
    setOrder(next)
    if (nextTracking) setTracking(nextTracking)
  }

  // Live follow-up: poll order + tracking + chat every 12s while the order is in flight.
  const orderActive = Boolean(order) && !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(order?.status || '')
  useEffect(() => {
    if (!order || !orderActive) return
    let stopped = false
    const tick = async () => {
      try {
        const [r, chat] = await Promise.all([fetchFoodOrderTracked(order.id), fetchFoodOrderMessages(order.id)])
        if (stopped) return
        applyOrderUpdate(r.order, r.tracking)
        setMessages(chat.messages)
      } catch {
        /* transient poll failure — next tick retries */
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 12000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, orderActive])

  async function sendChat() {
    if (!order || !chatInput.trim()) return
    const text = chatInput.trim()
    setChatInput('')
    try {
      const message = await sendFoodOrderMessage(order.id, text)
      setMessages((prev) => [...prev, message])
    } catch {
      setError(t.errGeneric)
    }
  }

  async function cancelAndBrowse() {
    if (!order) return
    setBusy(true)
    try {
      await cancelFoodOrder(order.id)
    } catch {
      /* already past cancel — the card will show the live status */
    } finally {
      setBusy(false)
      resetToBrowse()
    }
  }

  async function cancelOrder() {
    if (!order) return
    setBusy(true)
    setError('')
    try {
      setOrder(await cancelFoodOrder(order.id))
    } catch {
      setError(t.cancelBlocked)
    } finally {
      setBusy(false)
    }
  }

  function resetToBrowse() {
    setOrder(null)
    setMerchant(null)
    setCart({})
    setNotes('')
    try {
      window.localStorage.removeItem(ORDER_KEY)
    } catch {
      /* storage blocked */
    }
  }

  // ---- Screen 3: live order (follow-up, map, delay choices, chat) ----
  if (order) {
    const isPickup = order.fulfillment === 'pickup'
    const flow = isPickup ? PICKUP_FLOW : STATUS_FLOW
    const stepIndex = flow.indexOf(order.status as never)
    const terminal = order.status === 'DELIVERED' || order.status === 'CANCELLED' || order.status === 'REJECTED'
    const delayed = (order.delayedCount || 0) > delaySeen && ['ACCEPTED', 'PREPARING'].includes(order.status)
    const canCancel = order.status === 'PLACED' || ((order.delayedCount || 0) > 0 && ['ACCEPTED', 'PREPARING'].includes(order.status))
    // The map follows the stage: courier live position while on the way, else the restaurant.
    const courierQ = tracking?.courier ? `${tracking.courier.lat},${tracking.courier.lng}` : ''
    const merchantQ = tracking?.merchant ? `${tracking.merchant.lat},${tracking.merchant.lng}` : (order.merchant ? `${order.merchant.name} ${order.merchant.address || ''} ${order.merchant.city || ''}`.trim() : '')
    const mapQuery = order.status === 'PICKED_UP' && courierQ ? courierQ : merchantQ
    const statusLabel = isPickup && order.status === 'READY_FOR_PICKUP' ? t.stPickupReady : (t.st[order.status] || order.status)
    return (
      <main style={styles.page}>
        <section style={styles.card}>
          <h1 style={styles.h1}>{t.orderTitle}</h1>
          <p style={{ ...styles.statusBig, color: terminal && order.status !== 'DELIVERED' ? '#b91c1c' : '#166534' }}>
            {statusLabel}
          </p>
          {order.status === 'DELIVERED' ? <EatsRatingBox order={order} lang={lang} /> : null}
          {order.scheduledFor ? (
            <p style={styles.muted}>{t.scheduledForL}: <strong dir="ltr">{new Date(order.scheduledFor).toLocaleString(isAr ? 'ar-SY' : undefined)}</strong></p>
          ) : null}
          {order.etaAt && !terminal ? (
            <p style={styles.muted}>{t.etaL} <strong dir="ltr">{fmtClock(order.etaAt, lang)}</strong></p>
          ) : null}
          {tracking?.courierEtaMinutes != null && order.status === 'PICKED_UP' ? (
            <p style={styles.muted}>{t.courierEtaL} <strong dir="ltr">{tracking.courierEtaMinutes}</strong> {t.minutes}</p>
          ) : null}
          {stepIndex >= 0 ? (
            <div aria-hidden="true" style={styles.steps}>
              {flow.map((step, index) => (
                <span key={step} style={{ ...styles.stepDot, background: index <= stepIndex ? '#166534' : '#d9d9d9' }} />
              ))}
            </div>
          ) : null}

          {delayed ? (
            <div style={styles.delayBanner} role="alert">
              <strong>⏳ {t.delayedBanner} {fmtClock(order.etaAt, lang)}</strong>
              <span style={styles.mutedSmall}>{t.delayedChoices}</span>
              <div style={styles.row}>
                <button type="button" style={styles.secondaryBtn} onClick={() => setDelaySeen(order.delayedCount || 0)}>{t.iWillWait}</button>
                <button type="button" style={styles.dangerBtn} disabled={busy} onClick={() => void cancelOrder()}>{t.cancel}</button>
                <button type="button" style={styles.dangerBtn} disabled={busy} onClick={() => void cancelAndBrowse()}>{t.cancelAndSwitch}</button>
              </div>
            </div>
          ) : null}

          {!terminal && mapQuery ? (
            <div>
              <div style={styles.mapFrameWrap}>
                <iframe
                  title={t.mapTitle}
                  src={mapEmbedUrl(mapQuery, lang)}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  style={styles.mapFrame}
                  allowFullScreen
                />
              </div>
              {isPickup && merchantQ ? (
                <a href={mapDirectionsUrl(merchantQ)} target="_blank" rel="noreferrer" style={styles.mapLink}>
                  🧭 {t.directions}
                </a>
              ) : null}
            </div>
          ) : null}
          <div style={styles.lines}>
            {(order.items || []).map((line) => (
              <div key={line.id} style={styles.line}>
                <span dir="auto">{line.quantity} × {line.nameSnapshot}</span>
                <strong dir="ltr">{money(line.priceMinorSnapshot * line.quantity, order.currency, lang)}</strong>
              </div>
            ))}
            {order.deliveryFeeMinor > 0 ? (
              <div style={styles.line}><span>{t.deliveryFee}</span><strong dir="ltr">{money(order.deliveryFeeMinor, order.currency, lang)}</strong></div>
            ) : null}
            {order.serviceFeeMinor > 0 ? (
              <div style={styles.line}><span>{t.serviceFee}</span><strong dir="ltr">{money(order.serviceFeeMinor, order.currency, lang)}</strong></div>
            ) : null}
            <div style={{ ...styles.line, borderTop: '2px solid #000', paddingTop: 10 }}>
              <span style={{ fontWeight: 800 }}>{t.total}</span>
              <strong dir="ltr" style={{ fontSize: 18 }}>{money(order.totalMinor, order.currency, lang)}</strong>
            </div>
          </div>
          <p style={styles.muted} dir="auto">{isPickup ? `${t.pickup} · ${order.merchant?.address || ''}` : order.deliveryAddress}</p>
          {error ? <p role="alert" style={styles.error}>{error}</p> : null}
          <div style={styles.row}>
            {!terminal ? (
              <button type="button" style={styles.secondaryBtn} onClick={() => void refreshOrder()}>{t.refresh}</button>
            ) : null}
            {canCancel && !terminal ? (
              <button type="button" style={styles.dangerBtn} disabled={busy} onClick={() => void cancelOrder()}>{t.cancel}</button>
            ) : null}
            {terminal ? (
              <button type="button" style={styles.primaryBtn} onClick={resetToBrowse}>{t.newOrder}</button>
            ) : null}
          </div>
        </section>

        {!terminal ? (
          <section style={styles.card}>
            <h2 style={styles.h2}>{t.chatTitle}</h2>
            <div style={styles.chatList}>
              {messages.length === 0 ? <p style={styles.mutedSmall as CSSProperties}>—</p> : null}
              {messages.map((m) => (
                <div key={m.id} style={m.senderRole === 'customer' ? styles.chatMine : styles.chatTheirs}>
                  <span style={styles.chatRole}>{t.roleNames[m.senderRole] || m.senderRole}</span>
                  <span dir="auto">{m.body}</span>
                </div>
              ))}
            </div>
            <div style={styles.row}>
              <input
                dir="auto"
                style={{ ...styles.input, flex: 1 }}
                value={chatInput}
                placeholder={t.chatPlaceholder}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void sendChat() }}
              />
              <button type="button" style={styles.secondaryBtn} disabled={!chatInput.trim()} onClick={() => void sendChat()}>{t.send}</button>
            </div>
          </section>
        ) : null}
      </main>
    )
  }

  // ---- Screen 2: menu + cart ----
  if (merchant) {
    return (
      <main style={styles.page}>
        <button type="button" style={styles.backBtn} onClick={() => setMerchant(null)}>← {t.back}</button>
        <section style={styles.card}>
          <h1 style={styles.h1} dir="auto">{isAr && merchant.nameAr ? merchant.nameAr : merchant.name}</h1>
          <p style={styles.muted} dir="auto">{merchant.address} · {merchant.city}</p>
          {merchant.rating && merchant.rating.count > 0 ? (
            <p style={styles.mutedSmall}>★ {merchant.rating.average} ({merchant.rating.count})</p>
          ) : null}
          {merchant.minOrderMinor ? (
            <p style={styles.mutedSmall}>
              {pick(lang, 'الحد الأدنى للطلب', 'Minimum order', 'Commande minimum')}: <strong dir="ltr">{merchant.minOrderMinor}</strong>
            </p>
          ) : null}
          {merchant.openNow === false ? (
            <div style={styles.busyBanner} role="alert">
              <strong>🕒 {pick(lang, 'مغلق الآن', 'Closed right now', 'Fermé actuellement')}</strong>
              {merchant.openingHours ? (
                <span style={styles.mutedSmall} dir="ltr">{merchant.openingHours.open} – {merchant.openingHours.close}</span>
              ) : null}
              <span style={styles.mutedSmall}>{pick(lang, 'يمكنك جدولة طلبك لوقت لاحق أو اختيار مطعم آخر.', 'You can schedule your order for later or choose another restaurant.', 'Vous pouvez planifier votre commande ou choisir un autre restaurant.')}</span>
            </div>
          ) : null}
          {merchant.acceptingOrders === false ? (
            <div style={styles.busyBanner} role="alert">
              <strong>⏸ {t.busyBadge}</strong>
              <span style={styles.mutedSmall}>{t.busyBanner}</span>
              <div style={styles.row}>
                <button type="button" style={styles.secondaryBtn} onClick={() => { setScheduleOpen(true) }}>{t.scheduleToggle}</button>
                <button type="button" style={styles.secondaryBtn} onClick={() => setMerchant(null)}>{t.otherRestaurants}</button>
              </div>
            </div>
          ) : null}
          <h2 style={styles.h2}>{t.menuOf}</h2>
          <div style={styles.lines}>
            {menu.map((item) => (
              <div key={item.id} style={styles.menuRow}>
                {foodPhotoSrc(item.photoUrl) ? (
                  <img src={foodPhotoSrc(item.photoUrl) || undefined} alt="" style={styles.menuThumb} />
                ) : null}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div dir="auto" style={{ fontWeight: 700 }}>
                    {isAr && item.nameAr ? item.nameAr : item.name}
                    {item.promoActive && item.promoLabel ? <span style={styles.promoBadge} dir="auto"> {item.promoLabel}</span> : null}
                  </div>
                  {item.description ? <div dir="auto" style={styles.mutedSmall}>{item.description}</div> : null}
                  <div dir="ltr" style={{ fontWeight: 700, marginTop: 2 }}>
                    {item.promoActive && item.effectivePriceMinor != null ? (
                      <>
                        <s style={{ color: '#999', fontWeight: 600 }}>{money(item.priceMinor, item.currency, lang)}</s>{' '}
                        <span style={{ color: '#166534' }}>{money(item.effectivePriceMinor, item.currency, lang)}</span>
                      </>
                    ) : (
                      money(item.priceMinor, item.currency, lang)
                    )}
                  </div>
                </div>
                {(cart[item.id] || 0) > 0 ? (
                  <span style={styles.qtyGroup}>
                    <button type="button" aria-label="less" style={styles.qtyBtn} onClick={() => bump(item.id, -1)}>−</button>
                    <strong dir="ltr" style={{ minWidth: 20, textAlign: 'center' }}>{cart[item.id]}</strong>
                    <button type="button" aria-label="more" style={styles.qtyBtn} onClick={() => bump(item.id, 1)}>+</button>
                  </span>
                ) : (
                  <button type="button" style={styles.addBtn} onClick={() => bump(item.id, 1)}>{t.add}</button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section style={styles.card}>
          <h2 style={styles.h2}>{t.cart}</h2>
          {cartLines.length === 0 ? (
            <p style={styles.muted}>{t.cartEmpty}</p>
          ) : (
            <>
              <div style={styles.lines}>
                {cartLines.map((line) => (
                  <div key={line.item.id} style={styles.line}>
                    <span dir="auto">{line.quantity} × {isAr && line.item.nameAr ? line.item.nameAr : line.item.name}</span>
                    <strong dir="ltr">{money(unitPrice(line.item) * line.quantity, currency, lang)}</strong>
                  </div>
                ))}
                <div style={{ ...styles.line, borderTop: '2px solid #000', paddingTop: 10 }}>
                  <span style={{ fontWeight: 800 }}>{t.subtotal}</span>
                  <strong dir="ltr" style={{ fontSize: 18 }}>{money(subtotal, currency, lang)}</strong>
                </div>
              </div>
              <div style={styles.row} role="radiogroup" aria-label={t.delivery}>
                <button
                  type="button"
                  style={fulfillment === 'delivery' ? styles.toggleActive : styles.toggle}
                  onClick={() => setFulfillment('delivery')}
                >
                  🛵 {t.delivery}
                </button>
                <button
                  type="button"
                  style={fulfillment === 'pickup' ? styles.toggleActive : styles.toggle}
                  onClick={() => setFulfillment('pickup')}
                >
                  🚶 {t.pickup}
                </button>
              </div>
              {fulfillment === 'delivery' ? (
                <label style={styles.label}>
                  {t.address}
                  <input dir="auto" style={styles.input} value={address} placeholder={t.addressPh} onChange={(event) => setAddress(event.target.value)} />
                </label>
              ) : null}
              <label style={styles.label}>
                {t.notes}
                <input dir="auto" style={styles.input} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              <button type="button" style={styles.linkBtn} onClick={() => setScheduleOpen((v) => !v)}>
                🕐 {scheduleOpen ? t.scheduleNow : t.scheduleToggle}
              </button>
              {scheduleOpen ? (
                <label style={styles.label}>
                  {t.scheduledForL}
                  <input type="datetime-local" style={styles.input} value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />
                </label>
              ) : null}
              {error ? <p role="alert" style={styles.error}>{error}</p> : null}
              <button
                type="button"
                style={styles.primaryBtn}
                disabled={busy || ((merchant.acceptingOrders === false || merchant.openNow === false) && !(scheduleOpen && scheduledFor)) || (scheduleOpen && !scheduledFor)}
                onClick={() => void submitOrder()}
              >
                {busy ? t.placing : t.placeOrder}
              </button>
            </>
          )}
        </section>
      </main>
    )
  }

  // ---- Screen 1: browse ----
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.h1}>{t.browseTitle}</h1>
        <p style={styles.muted}>{t.browseSub}</p>
        <div style={styles.row}>
          <input
            dir="auto"
            style={{ ...styles.input, flex: 1 }}
            value={city}
            placeholder={t.cityFilter}
            onChange={(event) => setCity(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void loadMerchants(city) }}
          />
          <button type="button" style={styles.secondaryBtn} onClick={() => void loadMerchants(city)}>{t.search}</button>
        </div>
        {error ? <p role="alert" style={styles.error}>{error}</p> : null}
      </section>
      {merchants === null ? null : merchants.length === 0 ? (
        <section style={styles.card}><p style={styles.muted}>{t.empty}</p></section>
      ) : (
        merchants.map((m) => (
          <button key={m.id} type="button" style={styles.merchantCard} onClick={() => void openMerchant(m)}>
            {foodPhotoSrc(m.photoUrl) ? (
              <img src={foodPhotoSrc(m.photoUrl) || undefined} alt="" style={styles.merchantThumb} />
            ) : (
              <span style={styles.merchantEmoji} aria-hidden="true">{m.category === 'grocery' ? '🛒' : '🍽️'}</span>
            )}
            <span style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
              <span dir="auto" style={{ display: 'block', fontWeight: 800, fontSize: 16 }}>
                {isAr && m.nameAr ? m.nameAr : m.name}
                {m.acceptingOrders === false ? <span style={styles.busyTag}> {t.busyBadge}</span> : null}
                {m.openNow === false ? <span style={styles.busyTag}> {pick(lang, 'مغلق', 'Closed', 'Fermé')}</span> : null}
                {m.rating && m.rating.count > 0 ? <span style={styles.mutedSmall}> ★ {m.rating.average}</span> : null}
              </span>
              <span dir="auto" style={styles.mutedSmall}>{m.address} · {m.city}</span>
            </span>
            <span aria-hidden="true" style={{ fontSize: 18 }}>{isAr ? '‹' : '›'}</span>
          </button>
        ))
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 520, margin: '0 auto', padding: 16, display: 'grid', gap: 14 },
  card: { border: '1.5px solid #e2e2e2', borderRadius: 16, padding: 16, display: 'grid', gap: 10, background: '#fff' },
  h1: { margin: 0, fontSize: 24, fontWeight: 800 },
  h2: { margin: '4px 0 0', fontSize: 16, fontWeight: 800 },
  muted: { margin: 0, color: '#555', fontSize: 14 },
  mutedSmall: { display: 'block', color: '#666', fontSize: 12.5 },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  label: { display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 },
  input: { minHeight: 44, borderRadius: 10, border: '1.5px solid #cfcfcf', padding: '0 12px', fontSize: 15, fontWeight: 600, background: '#fff', color: '#000' },
  primaryBtn: { minHeight: 48, border: 0, borderRadius: 12, background: '#166534', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', padding: '0 16px' },
  secondaryBtn: { minHeight: 44, borderRadius: 12, border: '1.5px solid #166534', background: '#fff', color: '#166534', fontWeight: 800, fontSize: 14, cursor: 'pointer', padding: '0 14px' },
  dangerBtn: { minHeight: 44, borderRadius: 12, border: '1.5px solid #b91c1c', background: '#fff', color: '#b91c1c', fontWeight: 800, fontSize: 14, cursor: 'pointer', padding: '0 14px' },
  backBtn: { justifySelf: 'start', minHeight: 36, border: 0, background: 'transparent', color: '#166534', fontWeight: 800, fontSize: 14, cursor: 'pointer', padding: 0 },
  merchantCard: { display: 'flex', alignItems: 'center', gap: 12, border: '1.5px solid #e2e2e2', borderRadius: 16, padding: '14px 16px', background: '#fff', cursor: 'pointer', width: '100%' },
  merchantEmoji: { fontSize: 26 },
  merchantThumb: { width: 54, height: 54, borderRadius: 12, objectFit: 'cover', flexShrink: 0 },
  menuThumb: { width: 56, height: 56, borderRadius: 10, objectFit: 'cover', flexShrink: 0 },
  promoBadge: { display: 'inline-block', fontSize: 11, fontWeight: 800, color: '#166534', background: 'rgba(22,101,52,0.1)', borderRadius: 999, padding: '2px 8px', marginInlineStart: 6 },
  lines: { display: 'grid', gap: 10 },
  line: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 14.5 },
  menuRow: { display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #efefef', paddingBottom: 10 },
  addBtn: { minHeight: 36, borderRadius: 999, border: '1.5px solid #166534', background: '#fff', color: '#166534', fontWeight: 800, fontSize: 13, cursor: 'pointer', padding: '0 14px' },
  qtyGroup: { display: 'flex', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 32, height: 32, borderRadius: 8, border: '1.5px solid #166534', background: '#fff', color: '#166534', fontSize: 18, lineHeight: '1', cursor: 'pointer' },
  statusBig: { margin: 0, fontSize: 17, fontWeight: 800 },
  steps: { display: 'flex', gap: 6 },
  stepDot: { flex: 1, height: 6, borderRadius: 999 },
  error: { margin: 0, color: '#b91c1c', fontWeight: 700, fontSize: 13.5 },
  // Order experience
  toggle: { flex: 1, minHeight: 44, borderRadius: 12, border: '1.5px solid #cfcfcf', background: '#fff', color: '#333', fontWeight: 800, fontSize: 14, cursor: 'pointer' },
  toggleActive: { flex: 1, minHeight: 44, borderRadius: 12, border: '2px solid #166534', background: 'rgba(22,101,52,0.08)', color: '#166534', fontWeight: 800, fontSize: 14, cursor: 'pointer' },
  linkBtn: { justifySelf: 'start', border: 0, background: 'transparent', color: '#166534', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', padding: 0, textAlign: 'start' },
  busyTag: { fontSize: 11, fontWeight: 800, color: '#b45309', background: 'rgba(180,83,9,0.12)', borderRadius: 999, padding: '2px 8px', marginInlineStart: 6 },
  busyBanner: { border: '1.5px solid #b45309', background: 'rgba(180,83,9,0.07)', borderRadius: 12, padding: 12, display: 'grid', gap: 8 },
  delayBanner: { border: '1.5px solid #b45309', background: 'rgba(180,83,9,0.07)', borderRadius: 12, padding: 12, display: 'grid', gap: 8 },
  mapFrameWrap: { borderRadius: 12, overflow: 'hidden', lineHeight: 0, border: '1px solid rgba(0,0,0,0.08)' },
  mapFrame: { width: '100%', height: 220, border: 0, display: 'block' },
  mapLink: { marginTop: 8, display: 'inline-flex', gap: 6, color: '#166534', fontWeight: 800, fontSize: 13.5, textDecoration: 'none' },
  chatList: { display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' },
  chatMine: { justifySelf: 'end', maxWidth: '85%', background: 'rgba(22,101,52,0.1)', borderRadius: '12px 12px 2px 12px', padding: '8px 12px', display: 'grid', gap: 2, fontSize: 14 },
  chatTheirs: { justifySelf: 'start', maxWidth: '85%', background: '#f1f1f1', borderRadius: '12px 12px 12px 2px', padding: '8px 12px', display: 'grid', gap: 2, fontSize: 14 },
  chatRole: { fontSize: 11, fontWeight: 800, color: '#555' },
}
