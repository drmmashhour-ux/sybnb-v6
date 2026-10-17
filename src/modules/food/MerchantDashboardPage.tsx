import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { optimizePhoto } from '../../shared/lib/image-compress'
import type { Lang } from '../../engines/language/languageEngine'
import { pick } from '../../engines/language/languageEngine'
import { HostAccountForm } from '../account/HostJoinPage'
import {
  addFoodMenuItem,
  fetchFoodMenu,
  fetchMerchantFoodOrders,
  fetchMyFoodMerchants,
  foodPhotoSrc,
  getStoredGuestSession,
  registerFoodMerchant,
  updateFoodMenuItem,
  updateFoodOrderStatusAsMerchant,
  updateFoodMerchantSettings,
  delayFoodOrder,
  fetchFoodOrderMessages,
  sendFoodOrderMessage,
  uploadFoodMerchantPhoto,
  uploadMenuItemPhoto,
  type FoodMenuItem,
  type FoodMerchant,
  type FoodOrder,
} from '../../shared/api/platformApi'

// Menu Studio: photos are resized/WebP-compressed in the browser before upload; the server still
// enforces the standards and every photo goes to admin review.
const readFileAsBase64 = optimizePhoto

// datetime-local <input> value ↔ ISO string.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// SE (Eats) Phase 2 — merchant side: register a store (admin-approved before it can sell), manage
// its menu, and work incoming orders through the kitchen half of the lifecycle
// (accept/reject → preparing → ready). Ownership and every transition are enforced SERVER-side
// (server/routes/food.mjs); this page only surfaces them.
type Props = { lang: Lang }

function money(minor: number, currency: string, lang: Lang) {
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-SY' : lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor)
  } catch {
    return `${minor} ${currency}`
  }
}

export function MerchantDashboardPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = useMemo(
    () => ({
      title: pick(lang, 'لوحة المتجر', 'Merchant dashboard', 'Tableau de bord commerçant'),
      signIn: pick(lang, 'سجّل الدخول أولًا لإدارة متجرك.', 'Sign in first to manage your store.', 'Connectez-vous pour gérer votre magasin.'),
      registerTitle: pick(lang, 'سجّل متجرك', 'Register your store', 'Inscrire votre magasin'),
      registerHint: pick(lang, 'بعد التسجيل يراجع فريق SYBNB متجرك قبل تفعيله.', 'After registering, the SYBNB team reviews your store before it goes live.', "Après l'inscription, l'équipe SYBNB examine votre magasin avant sa mise en ligne."),
      nameL: pick(lang, 'اسم المتجر', 'Store name', 'Nom du magasin'),
      nameArL: pick(lang, 'الاسم بالعربية (اختياري)', 'Arabic name (optional)', 'Nom en arabe (optionnel)'),
      cityL: pick(lang, 'المدينة', 'City', 'Ville'),
      addressL: pick(lang, 'العنوان', 'Address', 'Adresse'),
      phoneL: pick(lang, 'الهاتف (اختياري)', 'Phone (optional)', 'Téléphone (optionnel)'),
      categoryL: pick(lang, 'النوع', 'Type', 'Type'),
      catRestaurant: pick(lang, 'مطعم', 'Restaurant', 'Restaurant'),
      catGrocery: pick(lang, 'بقالة/سوبرماركت', 'Grocery', 'Épicerie'),
      register: pick(lang, 'تسجيل المتجر', 'Register store', 'Inscrire'),
      statusBadge: {
        PENDING_REVIEW: pick(lang, 'قيد المراجعة', 'Pending review', 'En cours de revue'),
        APPROVED: pick(lang, 'معتمد', 'Approved', 'Approuvé'),
        SUSPENDED: pick(lang, 'موقوف', 'Suspended', 'Suspendu'),
      } as Record<string, string>,
      menuTitle: pick(lang, 'القائمة', 'Menu', 'Menu'),
      itemNameL: pick(lang, 'اسم الصنف', 'Item name', "Nom de l'article"),
      priceL: pick(lang, 'السعر (ل.س)', 'Price (SYP)', 'Prix (SYP)'),
      addItem: pick(lang, 'إضافة صنف', 'Add item', 'Ajouter'),
      available: pick(lang, 'متوفر', 'Available', 'Disponible'),
      unavailable: pick(lang, 'غير متوفر', 'Unavailable', 'Indisponible'),
      ordersTitle: pick(lang, 'الطلبات الواردة', 'Incoming orders', 'Commandes reçues'),
      refresh: pick(lang, 'تحديث', 'Refresh', 'Actualiser'),
      noOrders: pick(lang, 'لا توجد طلبات بعد.', 'No orders yet.', 'Aucune commande.'),
      accept: pick(lang, 'قبول', 'Accept', 'Accepter'),
      reject: pick(lang, 'رفض', 'Reject', 'Refuser'),
      startPreparing: pick(lang, 'بدء التحضير', 'Start preparing', 'Commencer'),
      markReady: pick(lang, 'جاهز للاستلام', 'Ready for pickup', 'Prêt'),
      st: {
        PLACED: pick(lang, 'جديد', 'New', 'Nouvelle'),
        ACCEPTED: pick(lang, 'مقبول', 'Accepted', 'Acceptée'),
        PREPARING: pick(lang, 'قيد التحضير', 'Preparing', 'En préparation'),
        READY_FOR_PICKUP: pick(lang, 'بانتظار السائق', 'Waiting for courier', 'Attente livreur'),
        PICKED_UP: pick(lang, 'مع السائق', 'With courier', 'Avec le livreur'),
        DELIVERED: pick(lang, 'سُلّم', 'Delivered', 'Livrée'),
        CANCELLED: pick(lang, 'ملغى', 'Cancelled', 'Annulée'),
        REJECTED: pick(lang, 'مرفوض', 'Rejected', 'Refusée'),
      } as Record<string, string>,
      error: pick(lang, 'حدث خطأ، حاول مرة أخرى.', 'Something went wrong, try again.', 'Une erreur est survenue.'),
      // Menu Studio
      studioTitle: pick(lang, 'استوديو القائمة', 'Menu Studio', 'Studio du menu'),
      coverPhoto: pick(lang, 'صورة الغلاف', 'Cover photo', 'Photo de couverture'),
      uploadPhoto: pick(lang, 'رفع صورة', 'Upload photo', 'Téléverser une photo'),
      replacePhoto: pick(lang, 'استبدال الصورة', 'Replace photo', 'Remplacer la photo'),
      photoHint: pick(
        lang,
        'JPEG/PNG/WebP، ‏640×480 على الأقل، حتى 5MB. تُراجع كل صورة قبل ظهورها للزبائن — الصور يجب أن تكون حقيقية لطبقك فعلاً.',
        'JPEG/PNG/WebP, at least 640×480, up to 5MB. Every photo is reviewed before customers see it — photos must be real shots of your actual dish.',
        'JPEG/PNG/WebP, au moins 640×480, jusqu’à 5 Mo. Chaque photo est vérifiée avant d’être visible — elle doit montrer votre vrai plat.',
      ),
      photoSt: {
        PENDING_REVIEW: pick(lang, 'الصورة قيد المراجعة', 'Photo in review', 'Photo en cours de revue'),
        APPROVED: pick(lang, 'صورة معتمدة ✓', 'Photo approved ✓', 'Photo approuvée ✓'),
        REJECTED: pick(lang, 'الصورة مرفوضة', 'Photo rejected', 'Photo rejetée'),
      } as Record<string, string>,
      promoBtn: pick(lang, 'عرض ترويجي', 'Promotion', 'Promotion'),
      promoPriceL: pick(lang, 'السعر الترويجي (ل.س)', 'Promo price (SYP)', 'Prix promo (SYP)'),
      promoLabelL: pick(lang, 'عنوان العرض (اختياري)', 'Promo label (optional)', 'Libellé (optionnel)'),
      promoFromL: pick(lang, 'يبدأ', 'Starts', 'Début'),
      promoUntilL: pick(lang, 'ينتهي', 'Ends', 'Fin'),
      promoSave: pick(lang, 'حفظ العرض', 'Save promo', 'Enregistrer'),
      promoClear: pick(lang, 'إلغاء العرض', 'Clear promo', 'Supprimer la promo'),
      promoActiveB: pick(lang, 'عرض فعّال', 'Promo live', 'Promo active'),
      close: pick(lang, 'إغلاق', 'Close', 'Fermer'),
      uploading: pick(lang, 'جارٍ الرفع...', 'Uploading...', 'Téléversement...'),
    }),
    [lang],
  )

  const [merchants, setMerchants] = useState<FoodMerchant[] | null>(null)
  const [selected, setSelected] = useState<FoodMerchant | null>(null)
  const [menu, setMenu] = useState<FoodMenuItem[]>([])
  const [orders, setOrders] = useState<FoodOrder[]>([])
  const [form, setForm] = useState({ name: '', nameAr: '', city: '', address: '', phone: '', category: 'restaurant' })
  const [itemForm, setItemForm] = useState({ name: '', price: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Menu Studio: which item's editor is open + its promo form, and which upload is in flight.
  const [studioItemId, setStudioItemId] = useState('')
  const [promoForm, setPromoForm] = useState({ price: '', label: '', from: '', until: '' })
  const [uploadingId, setUploadingId] = useState('')
  // Order experience: per-order chat drafts/logs and which order's chat is open.
  const [chatOpen, setChatOpen] = useState('')
  const [chatDraft, setChatDraft] = useState<Record<string, string>>({})
  const [chatLog, setChatLog] = useState<Record<string, Array<{ id: string; senderRole: string; body: string }>>>({})
  const [, setSessionTick] = useState(0)
  const hasSession = Boolean(getStoredGuestSession())

  function openStudio(item: FoodMenuItem) {
    setStudioItemId(item.id)
    setPromoForm({
      price: item.promoPriceMinor != null ? String(item.promoPriceMinor) : '',
      label: item.promoLabel || '',
      from: toLocalInput(item.promoStartsAt),
      until: toLocalInput(item.promoEndsAt),
    })
  }

  async function uploadPhoto(kind: 'merchant' | 'item', id: string, file: File | null | undefined) {
    if (!file) return
    setUploadingId(id)
    setError('')
    try {
      const { base64, mimeType } = await readFileAsBase64(file)
      if (kind === 'item') {
        const updated = await uploadMenuItemPhoto(id, base64, mimeType)
        setMenu((prev) => prev.map((row) => (row.id === id ? updated : row)))
      } else {
        const updated = await uploadFoodMerchantPhoto(id, base64, mimeType)
        setSelected(updated)
        setMerchants((prev) => (prev ? prev.map((m) => (m.id === id ? updated : m)) : prev))
      }
    } catch (err) {
      setError((err as Error).message || t.error)
    } finally {
      setUploadingId('')
    }
  }

  async function savePromo(item: FoodMenuItem) {
    setBusy(true)
    setError('')
    try {
      const updated = await updateFoodMenuItem(item.id, {
        promoPriceMinor: Number(promoForm.price),
        promoLabel: promoForm.label || null,
        promoStartsAt: promoForm.from ? new Date(promoForm.from).toISOString() : null,
        promoEndsAt: promoForm.until ? new Date(promoForm.until).toISOString() : null,
      })
      setMenu((prev) => prev.map((row) => (row.id === item.id ? updated : row)))
    } catch (err) {
      setError((err as Error).message || t.error)
    } finally {
      setBusy(false)
    }
  }

  async function clearPromo(item: FoodMenuItem) {
    setBusy(true)
    setError('')
    try {
      const updated = await updateFoodMenuItem(item.id, { promoPriceMinor: null })
      setMenu((prev) => prev.map((row) => (row.id === item.id ? updated : row)))
      setPromoForm({ price: '', label: '', from: '', until: '' })
    } catch (err) {
      setError((err as Error).message || t.error)
    } finally {
      setBusy(false)
    }
  }

  async function loadMerchants() {
    try {
      const mine = await fetchMyFoodMerchants()
      setMerchants(mine)
      if (mine.length && !selected) void selectMerchant(mine[0])
    } catch {
      setMerchants([])
    }
  }

  async function selectMerchant(m: FoodMerchant) {
    setSelected(m)
    setError('')
    try {
      const [menuRes, orderRows] = await Promise.all([fetchFoodMenu(m.id), fetchMerchantFoodOrders(m.id)])
      setMenu(menuRes.items)
      setOrders(orderRows)
    } catch {
      setError(t.error)
    }
  }

  useEffect(() => {
    if (hasSession) void loadMerchants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSession])

  // Live orders: a restaurant should not have to tap Refresh to see a new order. Poll every 15 s while
  // the page is visible, refresh the moment the tab is shown again or the network returns, and tell the
  // kitchen plainly when the connection is down so they do not assume "no new orders".
  const [ordersStale, setOrdersStale] = useState(false)
  const selectedId = selected?.id
  useEffect(() => {
    if (!hasSession || !selectedId) return undefined
    let stopped = false
    async function poll() {
      if (document.hidden) return
      try {
        const rows = await fetchMerchantFoodOrders(selectedId as string)
        if (!stopped) { setOrders(rows); setOrdersStale(false) }
      } catch {
        if (!stopped) setOrdersStale(true)
      }
    }
    const timer = window.setInterval(() => void poll(), 15000)
    const onWake = () => { if (!document.hidden) void poll() }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('online', onWake)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('online', onWake)
    }
  }, [hasSession, selectedId])

  async function submitRegister() {
    setBusy(true)
    setError('')
    try {
      await registerFoodMerchant({
        name: form.name,
        nameAr: form.nameAr || undefined,
        city: form.city,
        address: form.address,
        phone: form.phone || undefined,
        category: form.category,
      })
      setForm({ name: '', nameAr: '', city: '', address: '', phone: '', category: 'restaurant' })
      await loadMerchants()
    } catch (err) {
      setError((err as Error).message || t.error)
    } finally {
      setBusy(false)
    }
  }

  async function submitMenuItem() {
    if (!selected) return
    const priceMinor = Number(itemForm.price)
    setBusy(true)
    setError('')
    try {
      await addFoodMenuItem(selected.id, { name: itemForm.name, priceMinor })
      setItemForm({ name: '', price: '' })
      const menuRes = await fetchFoodMenu(selected.id)
      setMenu(menuRes.items)
    } catch (err) {
      setError((err as Error).message || t.error)
    } finally {
      setBusy(false)
    }
  }

  async function toggleAvailability(item: FoodMenuItem) {
    try {
      const updated = await updateFoodMenuItem(item.id, { available: !item.available })
      setMenu((prev) => prev.map((row) => (row.id === item.id ? updated : row)))
    } catch {
      setError(t.error)
    }
  }

  async function transition(order: FoodOrder, status: 'ACCEPTED' | 'REJECTED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'DELIVERED', prepMinutes?: number) {
    setError('')
    try {
      const updated = await updateFoodOrderStatusAsMerchant(order.id, status, prepMinutes ? { prepMinutes } : undefined)
      setOrders((prev) => prev.map((row) => (row.id === order.id ? { ...row, ...updated } : row)))
    } catch (err) {
      setError((err as Error).message || t.error)
    }
  }

  // Map pin: the restaurant stands at its door and taps once. Browser geolocation, no maps key.
  async function setStorePin() {
    if (!selected || !navigator.geolocation) {
      setError(t.error)
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const updated = await updateFoodMerchantSettings(selected.id, { lat: pos.coords.latitude, lng: pos.coords.longitude })
          setSelected(updated)
          setMerchants((prev) => (prev ? prev.map((m) => (m.id === updated.id ? updated : m)) : prev))
        } catch (err) {
          setError((err as Error).message || t.error)
        }
      },
      () => setError(t.error),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  // Busy mode: the merchant's own pause switch. Customers see it immediately in browse.
  async function toggleAccepting() {
    if (!selected) return
    setError('')
    try {
      const updated = await updateFoodMerchantSettings(selected.id, { acceptingOrders: selected.acceptingOrders === false })
      setSelected(updated)
      setMerchants((prev) => (prev ? prev.map((m) => (m.id === updated.id ? updated : m)) : prev))
    } catch (err) {
      setError((err as Error).message || t.error)
    }
  }

  // Delay: moves the promise forward and gives the customer their choice back.
  async function delay(order: FoodOrder, extraMinutes: number) {
    setError('')
    try {
      const updated = await delayFoodOrder(order.id, extraMinutes)
      setOrders((prev) => prev.map((row) => (row.id === order.id ? { ...row, ...updated } : row)))
    } catch (err) {
      setError((err as Error).message || t.error)
    }
  }

  async function sendOrderChat(orderId: string) {
    const body = (chatDraft[orderId] || '').trim()
    if (!body) return
    setChatDraft((prev) => ({ ...prev, [orderId]: '' }))
    try {
      const message = await sendFoodOrderMessage(orderId, body)
      setChatLog((prev) => ({ ...prev, [orderId]: [...(prev[orderId] || []), message] }))
    } catch (err) {
      setError((err as Error).message || t.error)
    }
  }

  async function openChat(orderId: string) {
    setChatOpen((prev) => (prev === orderId ? '' : orderId))
    try {
      const r = await fetchFoodOrderMessages(orderId)
      setChatLog((prev) => ({ ...prev, [orderId]: r.messages }))
    } catch {
      /* chat unavailable — the order actions still work */
    }
  }

  if (!hasSession) {
    return (
      <main style={styles.page}>
        <h1 style={styles.h1}>{t.title}</h1>
        <p style={styles.muted}>{t.signIn}</p>
        <HostAccountForm lang={lang} kind="SELLER" onSignedIn={() => setSessionTick((n) => n + 1)} />
      </main>
    )
  }

  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>{t.title}</h1>
      {error ? <p role="alert" style={styles.error}>{error}</p> : null}

      {merchants !== null && merchants.length > 0 ? (
        <section style={styles.card}>
          <div style={styles.rowWrap}>
            {merchants.map((m) => (
              <button
                key={m.id}
                type="button"
                style={selected?.id === m.id ? { ...styles.chip, ...styles.chipActive } : styles.chip}
                onClick={() => void selectMerchant(m)}
              >
                <span dir="auto">{isAr && m.nameAr ? m.nameAr : m.name}</span>
                <span style={styles.badge}>{t.statusBadge[m.status] || m.status}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selected ? (
        <>
          <section style={styles.card}>
            <div style={styles.rowBetween}>
              <h2 style={styles.h2}>{t.ordersTitle}</h2>
              <button
                type="button"
                style={selected.acceptingOrders === false ? styles.primaryBtnSm : styles.dangerBtnSm}
                onClick={() => void toggleAccepting()}
              >
                {selected.acceptingOrders === false ? '▶ Accepting orders again' : '⏸ Stop accepting orders (busy)'}
              </button>
            </div>
            <div style={styles.rowWrap}>
              <button type="button" style={styles.secondaryBtnSm} onClick={() => void setStorePin()}>
                📍 {selected.lat != null ? 'Update store map pin' : 'Set store map pin (stand at the door)'}
              </button>
              {selected.lat != null ? <span style={styles.mutedSmall}>pin set</span> : null}
            </div>
            {selected.acceptingOrders === false ? (
              <p style={styles.muted}>Busy mode is ON — new instant orders are refused; customers are offered scheduling or other restaurants.</p>
            ) : null}
            <button type="button" style={styles.secondaryBtn} onClick={() => void selectMerchant(selected)}>{t.refresh}</button>
            {ordersStale ? (
              <p style={{ ...styles.muted, color: '#b42318', fontWeight: 700 }}>
                {pick(lang, '⚠️ الاتصال ضعيف — قد توجد طلبات جديدة لا تظهر. نعيد المحاولة تلقائياً.', '⚠️ Connection problem — new orders may not be showing. Retrying automatically.', '⚠️ Problème de connexion — de nouvelles commandes peuvent ne pas s’afficher. Nouvelle tentative automatique.')}
              </p>
            ) : null}
            {orders.length === 0 ? (
              <p style={styles.muted}>{t.noOrders}</p>
            ) : (
              orders.map((order) => (
                <div key={order.id} style={styles.orderRow}>
                  <div style={styles.rowBetween}>
                    <strong>{t.st[order.status] || order.status}</strong>
                    <strong dir="ltr">{money(order.totalMinor, order.currency, lang)}</strong>
                  </div>
                  <div style={styles.mutedSmall} dir="auto">
                    {(order.items || []).map((line) => `${line.quantity}× ${line.nameSnapshot}`).join(' · ')}
                  </div>
                  <div style={styles.mutedSmall} dir="auto">{order.deliveryAddress}{order.notes ? ` — ${order.notes}` : ''}</div>
                  <div style={styles.mutedSmall}>
                    {order.fulfillment === 'pickup' ? '🚶 pickup' : '🛵 delivery'}
                    {order.scheduledFor ? ` · scheduled ${new Date(order.scheduledFor).toLocaleString()}` : ''}
                    {order.etaAt ? ` · ready by ${new Date(order.etaAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                    {order.delayedCount ? ` · delayed ×${order.delayedCount}` : ''}
                  </div>
                  <div style={styles.rowWrap}>
                    {order.status === 'PLACED' ? (
                      <>
                        <button type="button" style={styles.primaryBtnSm} onClick={() => void transition(order, 'ACCEPTED', 15)}>{t.accept} · 15′</button>
                        <button type="button" style={styles.primaryBtnSm} onClick={() => void transition(order, 'ACCEPTED', 30)}>{t.accept} · 30′</button>
                        <button type="button" style={styles.dangerBtnSm} onClick={() => void transition(order, 'REJECTED')}>{t.reject}</button>
                      </>
                    ) : null}
                    {order.status === 'ACCEPTED' ? (
                      <button type="button" style={styles.primaryBtnSm} onClick={() => void transition(order, 'PREPARING')}>{t.startPreparing}</button>
                    ) : null}
                    {order.status === 'PREPARING' ? (
                      <button type="button" style={styles.primaryBtnSm} onClick={() => void transition(order, 'READY_FOR_PICKUP')}>{t.markReady}</button>
                    ) : null}
                    {(order.status === 'ACCEPTED' || order.status === 'PREPARING') ? (
                      <>
                        <button type="button" style={styles.secondaryBtnSm} onClick={() => void delay(order, 15)}>⏳ +15′</button>
                        <button type="button" style={styles.secondaryBtnSm} onClick={() => void delay(order, 30)}>⏳ +30′</button>
                      </>
                    ) : null}
                    {order.status === 'READY_FOR_PICKUP' && order.fulfillment === 'pickup' ? (
                      <button type="button" style={styles.primaryBtnSm} onClick={() => void transition(order, 'DELIVERED')}>✅ handed to customer</button>
                    ) : null}
                    <button type="button" style={styles.secondaryBtnSm} onClick={() => void openChat(order.id)}>💬 chat</button>
                  </div>
                  {chatOpen === order.id ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {(chatLog[order.id] || []).map((m) => (
                        <div key={m.id} style={styles.mutedSmall} dir="auto">
                          <strong>{m.senderRole}:</strong> {m.body}
                        </div>
                      ))}
                      <div style={styles.rowWrap}>
                        <input
                          dir="auto"
                          style={{ ...styles.input, flex: 1, minWidth: 140 }}
                          placeholder="Message the customer or courier…"
                          value={chatDraft[order.id] || ''}
                          onChange={(event) => setChatDraft((prev) => ({ ...prev, [order.id]: event.target.value }))}
                          onKeyDown={(event) => { if (event.key === 'Enter') void sendOrderChat(order.id) }}
                        />
                        <button type="button" style={styles.secondaryBtnSm} onClick={() => void sendOrderChat(order.id)}>Send</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </section>

          <section style={styles.card}>
            <h2 style={styles.h2}>{t.coverPhoto}</h2>
            <p style={styles.mutedSmall}>{t.photoHint}</p>
            <div style={styles.rowWrap}>
              {foodPhotoSrc(selected.photoUrl) ? (
                <img src={foodPhotoSrc(selected.photoUrl) || undefined} alt="" style={styles.coverImg} />
              ) : (
                <div style={styles.coverPlaceholder}>🏪</div>
              )}
              <div style={{ display: 'grid', gap: 6 }}>
                {selected.photoStatus ? (
                  <span style={selected.photoStatus === 'APPROVED' ? styles.badgeOk : selected.photoStatus === 'REJECTED' ? styles.badgeBad : styles.badge}>
                    {t.photoSt[selected.photoStatus] || selected.photoStatus}
                  </span>
                ) : null}
                {selected.photoStatus === 'REJECTED' && selected.photoReviewNote ? (
                  <span style={styles.rejectNote} dir="auto">{selected.photoReviewNote}</span>
                ) : null}
                <label style={styles.uploadLabel}>
                  {uploadingId === selected.id ? t.uploading : selected.photoUrl ? t.replacePhoto : t.uploadPhoto}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={styles.fileInput}
                    disabled={uploadingId === selected.id}
                    onChange={(event) => { void uploadPhoto('merchant', selected.id, event.target.files?.[0]); event.target.value = '' }}
                  />
                </label>
              </div>
            </div>
          </section>

          <section style={styles.card}>
            <h2 style={styles.h2}>{t.studioTitle}</h2>
            <p style={styles.mutedSmall}>{t.photoHint}</p>
            {menu.map((item) => {
              const open = studioItemId === item.id
              return (
                <div key={item.id} style={styles.itemCard}>
                  <div style={styles.itemRow}>
                    {foodPhotoSrc(item.photoUrl) ? (
                      <img src={foodPhotoSrc(item.photoUrl) || undefined} alt="" style={styles.thumb} />
                    ) : (
                      <div style={styles.thumbPlaceholder}>🍽️</div>
                    )}
                    <div style={{ display: 'grid', gap: 3, flex: 1, minWidth: 0 }}>
                      <span dir="auto" style={{ fontWeight: 700, opacity: item.available ? 1 : 0.5 }}>
                        {isAr && item.nameAr ? item.nameAr : item.name}
                      </span>
                      <span dir="ltr" style={styles.priceLine}>
                        {item.promoActive && item.effectivePriceMinor != null ? (
                          <>
                            <s style={{ opacity: 0.55 }}>{money(item.priceMinor, item.currency, lang)}</s>{' '}
                            <strong style={{ color: '#16a34a' }}>{money(item.effectivePriceMinor, item.currency, lang)}</strong>
                          </>
                        ) : (
                          money(item.priceMinor, item.currency, lang)
                        )}
                      </span>
                      <div style={styles.rowWrap}>
                        {item.promoActive ? <span style={styles.badgeOk}>{t.promoActiveB}</span> : null}
                        {item.photoStatus ? (
                          <span style={item.photoStatus === 'APPROVED' ? styles.badgeOk : item.photoStatus === 'REJECTED' ? styles.badgeBad : styles.badge}>
                            {t.photoSt[item.photoStatus] || item.photoStatus}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                      <button type="button" style={item.available ? styles.secondaryBtnSm : styles.primaryBtnSm} onClick={() => void toggleAvailability(item)}>
                        {item.available ? t.unavailable : t.available}
                      </button>
                      <button type="button" style={styles.secondaryBtnSm} onClick={() => (open ? setStudioItemId('') : openStudio(item))}>
                        {open ? t.close : t.promoBtn}
                      </button>
                    </div>
                  </div>
                  {item.photoStatus === 'REJECTED' && item.photoReviewNote ? (
                    <span style={styles.rejectNote} dir="auto">{item.photoReviewNote}</span>
                  ) : null}
                  {open ? (
                    <div style={styles.studioBox}>
                      <label style={styles.uploadLabel}>
                        {uploadingId === item.id ? t.uploading : item.photoUrl ? t.replacePhoto : t.uploadPhoto}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          style={styles.fileInput}
                          disabled={uploadingId === item.id}
                          onChange={(event) => { void uploadPhoto('item', item.id, event.target.files?.[0]); event.target.value = '' }}
                        />
                      </label>
                      <div style={styles.rowWrap}>
                        <input dir="ltr" inputMode="numeric" style={{ ...styles.input, flex: 1, minWidth: 110 }} placeholder={t.promoPriceL} value={promoForm.price} onChange={(event) => setPromoForm((f) => ({ ...f, price: event.target.value }))} />
                        <input dir="auto" style={{ ...styles.input, flex: 2, minWidth: 130 }} placeholder={t.promoLabelL} value={promoForm.label} onChange={(event) => setPromoForm((f) => ({ ...f, label: event.target.value }))} />
                      </div>
                      <div style={styles.rowWrap}>
                        <label style={styles.dtLabel}>
                          {t.promoFromL}
                          <input type="datetime-local" style={styles.input} value={promoForm.from} onChange={(event) => setPromoForm((f) => ({ ...f, from: event.target.value }))} />
                        </label>
                        <label style={styles.dtLabel}>
                          {t.promoUntilL}
                          <input type="datetime-local" style={styles.input} value={promoForm.until} onChange={(event) => setPromoForm((f) => ({ ...f, until: event.target.value }))} />
                        </label>
                      </div>
                      <div style={styles.rowWrap}>
                        <button type="button" style={styles.primaryBtnSm} disabled={busy || !Number(promoForm.price)} onClick={() => void savePromo(item)}>{t.promoSave}</button>
                        {item.promoPriceMinor != null ? (
                          <button type="button" style={styles.dangerBtnSm} disabled={busy} onClick={() => void clearPromo(item)}>{t.promoClear}</button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
            <div style={styles.rowWrap}>
              <input dir="auto" style={{ ...styles.input, flex: 2, minWidth: 140 }} placeholder={t.itemNameL} value={itemForm.name} onChange={(event) => setItemForm((f) => ({ ...f, name: event.target.value }))} />
              <input dir="ltr" inputMode="numeric" style={{ ...styles.input, flex: 1, minWidth: 90 }} placeholder={t.priceL} value={itemForm.price} onChange={(event) => setItemForm((f) => ({ ...f, price: event.target.value }))} />
              <button type="button" style={styles.primaryBtnSm} disabled={busy || !itemForm.name || !Number(itemForm.price)} onClick={() => void submitMenuItem()}>{t.addItem}</button>
            </div>
          </section>
        </>
      ) : null}

      <section style={styles.card}>
        <h2 style={styles.h2}>{t.registerTitle}</h2>
        <p style={styles.muted}>{t.registerHint}</p>
        <input dir="auto" style={styles.input} placeholder={t.nameL} value={form.name} onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))} />
        <input dir="rtl" style={styles.input} placeholder={t.nameArL} value={form.nameAr} onChange={(event) => setForm((f) => ({ ...f, nameAr: event.target.value }))} />
        <div style={styles.rowWrap}>
          <input dir="auto" style={{ ...styles.input, flex: 1, minWidth: 120 }} placeholder={t.cityL} value={form.city} onChange={(event) => setForm((f) => ({ ...f, city: event.target.value }))} />
          <select style={{ ...styles.input, flex: 1, minWidth: 120 }} value={form.category} onChange={(event) => setForm((f) => ({ ...f, category: event.target.value }))}>
            <option value="restaurant">{t.catRestaurant}</option>
            <option value="grocery">{t.catGrocery}</option>
          </select>
        </div>
        <input dir="auto" style={styles.input} placeholder={t.addressL} value={form.address} onChange={(event) => setForm((f) => ({ ...f, address: event.target.value }))} />
        <input dir="ltr" style={styles.input} placeholder={t.phoneL} value={form.phone} onChange={(event) => setForm((f) => ({ ...f, phone: event.target.value }))} />
        <button type="button" style={styles.primaryBtn} disabled={busy || !form.name || !form.city || !form.address} onClick={() => void submitRegister()}>
          {t.register}
        </button>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 640, margin: '0 auto', padding: 16, display: 'grid', gap: 14 },
  h1: { margin: 0, fontSize: 24, fontWeight: 800 },
  h2: { margin: 0, fontSize: 16, fontWeight: 800 },
  card: { border: '1px solid rgba(148,163,184,0.35)', borderRadius: 16, padding: 16, display: 'grid', gap: 10 },
  muted: { margin: 0, opacity: 0.75, fontSize: 14 },
  mutedSmall: { opacity: 0.65, fontSize: 12.5 },
  rowWrap: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  rowBetween: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  chip: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 38, borderRadius: 999, border: '1px solid rgba(148,163,184,0.5)', background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 13, padding: '0 14px', cursor: 'pointer' },
  chipActive: { border: '1.5px solid #22d3ee', color: '#22d3ee' },
  badge: { fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '2px 8px', background: 'rgba(148,163,184,0.2)' },
  input: { minHeight: 44, borderRadius: 10, border: '1px solid rgba(148,163,184,0.5)', padding: '0 12px', fontSize: 14.5, fontWeight: 600, background: 'transparent', color: 'inherit' },
  primaryBtn: { minHeight: 46, border: 0, borderRadius: 12, background: '#22d3ee', color: '#06202a', fontWeight: 800, fontSize: 15, cursor: 'pointer', padding: '0 16px' },
  primaryBtnSm: { minHeight: 36, border: 0, borderRadius: 10, background: '#22d3ee', color: '#06202a', fontWeight: 800, fontSize: 13, cursor: 'pointer', padding: '0 12px' },
  secondaryBtn: { justifySelf: 'start', minHeight: 36, borderRadius: 10, border: '1px solid rgba(148,163,184,0.5)', background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: '0 12px' },
  secondaryBtnSm: { minHeight: 32, borderRadius: 10, border: '1px solid rgba(148,163,184,0.5)', background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', padding: '0 10px' },
  dangerBtnSm: { minHeight: 36, borderRadius: 10, border: '1.5px solid #f87171', background: 'transparent', color: '#f87171', fontWeight: 800, fontSize: 13, cursor: 'pointer', padding: '0 12px' },
  // Menu Studio
  itemCard: { border: '1px solid rgba(148,163,184,0.3)', borderRadius: 14, padding: 10, display: 'grid', gap: 8 },
  itemRow: { display: 'flex', gap: 10, alignItems: 'center' },
  thumb: { width: 64, height: 64, borderRadius: 12, objectFit: 'cover', flexShrink: 0 },
  thumbPlaceholder: { width: 64, height: 64, borderRadius: 12, background: 'rgba(148,163,184,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 },
  coverImg: { width: 128, height: 96, borderRadius: 12, objectFit: 'cover' },
  coverPlaceholder: { width: 128, height: 96, borderRadius: 12, background: 'rgba(148,163,184,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 },
  badgeOk: { fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '2px 8px', background: 'rgba(22,163,74,0.15)', color: '#16a34a' },
  badgeBad: { fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '2px 8px', background: 'rgba(248,113,113,0.15)', color: '#f87171' },
  rejectNote: { fontSize: 12.5, color: '#f87171', fontWeight: 600 },
  uploadLabel: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 38, borderRadius: 10, border: '1.5px dashed rgba(148,163,184,0.6)', fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: '0 14px', position: 'relative', overflow: 'hidden' },
  fileInput: { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' },
  studioBox: { borderTop: '1px dashed rgba(148,163,184,0.4)', paddingTop: 10, display: 'grid', gap: 8 },
  dtLabel: { display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, flex: 1, minWidth: 150 },
  priceLine: { fontSize: 13.5 },
  primaryLink: { justifySelf: 'start', minHeight: 44, display: 'inline-flex', alignItems: 'center', borderRadius: 12, background: '#22d3ee', color: '#06202a', fontWeight: 800, fontSize: 14, textDecoration: 'none', padding: '0 18px' },
  error: { margin: 0, color: '#f87171', fontWeight: 700, fontSize: 13.5 },
}
