import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { moneyText } from '../../shared/i18n/display'
import {
  cancelListingAuction,
  createStripeSetupSession,
  fetchAuctionByListing,
  fetchAuctionBids,
  finalizeListingAuction,
  getStoredGuestSession,
  placeAuctionBid,
  type AuctionBid,
  type PlatformAuction,
  type PlatformListing,
} from '../../shared/api/platformApi'

type Props = { listing: PlatformListing; lang: Lang }

const GUEST_RETURN_PATH_KEY = 'sybnb.v6.guestReturnPath'

function countdownText(ms: number, lang: Lang) {
  if (ms <= 0) return pick(lang, 'انتهى', 'Ended', 'Terminé')
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return pick(lang, `${d}ي ${h}س`, `${d}d ${h}h`, `${d}j ${h}h`)
  if (h > 0) return pick(lang, `${h}س ${m}د`, `${h}h ${m}m`, `${h}h ${m}m`)
  if (m > 0) return `${m}:${String(sec).padStart(2, '0')}`
  return pick(lang, `${sec}ث`, `${sec}s`, `${sec}s`)
}

export function AuctionPanel({ listing, lang }: Props) {
  const isAr = lang === 'ar'
  const [auction, setAuction] = useState<PlatformAuction | null>(null)
  const [bids, setBids] = useState<AuctionBid[]>([])
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const amountTouched = useRef(false)

  async function load(quiet = false) {
    try {
      const a = await fetchAuctionByListing(listing.id)
      setAuction(a)
      if (a) {
        if (!amountTouched.current) setAmount(String(a.minNextBidMinor))
        fetchAuctionBids(a.id).then(setBids).catch(() => {})
      }
      if (!quiet) setError(null)
    } catch {
      /* non-fatal: a fixed-price listing simply has no auction */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id])

  // Live countdown + periodic refresh while the auction is running.
  useEffect(() => {
    if (!auction || auction.status !== 'LIVE') return
    const tick = setInterval(() => setTick((n) => n + 1), 1000)
    const refresh = setInterval(() => void load(true), 10000)
    return () => {
      clearInterval(tick)
      clearInterval(refresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction?.id, auction?.status])

  if (loading || !auction) return null

  const a = auction

  const currency = a.currency
  const isLive = a.status === 'LIVE'
  const ended = a.status === 'ENDED' || a.status === 'SETTLED' || a.status === 'CANCELLED'
  const msLeft = Math.max(0, new Date(a.endsAt).getTime() - Date.now())
  const currentText = a.currentBidMinor != null
    ? moneyText(a.currentBidMinor, currency, lang)
    : moneyText(a.startMinor, currency, lang)

  const signedIn = Boolean(getStoredGuestSession())

  function goSignIn() {
    try {
      sessionStorage.setItem(GUEST_RETURN_PATH_KEY, `/listing/${listing.id}`)
    } catch {
      /* storage unavailable */
    }
    window.location.hash = `/account/open/${listing.id}`
  }

  async function addCardThenBid() {
    setBusy(true)
    setError(null)
    try {
      const { url } = await createStripeSetupSession()
      window.location.href = url
    } catch (err) {
      const e = err as { code?: string }
      if (e.code === 'GUEST_SESSION_REQUIRED') return goSignIn()
      setError(pick(lang, 'تعذر بدء إضافة البطاقة.', 'Could not start adding a card.', 'Impossible d’ajouter une carte.'))
      setBusy(false)
    }
  }

  async function submitBid() {
    const value = Math.round(Number(amount))
    if (!Number.isFinite(value) || value <= 0) {
      setError(pick(lang, 'أدخل مبلغاً صحيحاً.', 'Enter a valid amount.', 'Entrez un montant valide.'))
      return
    }
    if (value < a.minNextBidMinor) {
      setError(
        pick(
          lang,
          `الحد الأدنى للمزايدة ${moneyText(a.minNextBidMinor, currency, lang)}.`,
          `Minimum bid is ${moneyText(a.minNextBidMinor, currency, lang)}.`,
          `L’enchère minimale est ${moneyText(a.minNextBidMinor, currency, lang)}.`,
        ),
      )
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const updated = await placeAuctionBid(a.id, value)
      setAuction(updated)
      amountTouched.current = false
      setAmount(String(updated.minNextBidMinor))
      setNotice(pick(lang, 'تم تسجيل مزايدتك. أنت الأعلى الآن.', 'Your bid is in. You are the top bidder.', 'Votre enchère est enregistrée. Vous êtes en tête.'))
      fetchAuctionBids(a.id).then(setBids).catch(() => {})
    } catch (err) {
      const e = err as { code?: string; message?: string }
      if (e.code === 'GUEST_SESSION_REQUIRED') return goSignIn()
      if (e.code === 'AUCTION_CARD_REQUIRED') {
        setError(pick(lang, 'تتطلب هذه المزايدة بطاقة محفوظة.', 'This auction requires a saved card to bid.', 'Cette enchère exige une carte enregistrée.'))
        setBusy(false)
        return
      }
      setError(e.message || pick(lang, 'تعذر تسجيل المزايدة.', 'Could not place the bid.', 'Impossible d’enchérir.'))
    } finally {
      setBusy(false)
    }
  }

  async function sellerCancel() {
    if (!window.confirm(pick(lang, 'إلغاء هذا المزاد؟', 'Cancel this auction?', 'Annuler cette enchère ?'))) return
    setBusy(true)
    try {
      setAuction(await cancelListingAuction(a.id))
    } catch (err) {
      setError((err as { message?: string }).message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  async function sellerFinalize() {
    if (!window.confirm(pick(lang, 'إنهاء المزاد الآن؟', 'End the auction now?', 'Terminer l’enchère maintenant ?'))) return
    setBusy(true)
    try {
      setAuction(await finalizeListingAuction(a.id))
    } catch (err) {
      setError((err as { message?: string }).message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'} aria-label="auction">
      <div style={styles.headRow}>
        <span style={styles.badge}>{pick(lang, 'مزاد', 'Auction', 'Enchère')}</span>
        {isLive && (
          <span style={{ ...styles.timer, color: msLeft < 120000 ? '#ff5a5f' : '#0b1b3b' }}>
            ⏱ {countdownText(msLeft, lang)}
          </span>
        )}
        {ended && <span style={styles.endedTag}>{pick(lang, 'منتهٍ', 'Closed', 'Clôturée')}</span>}
      </div>

      <div style={styles.priceRow}>
        <div>
          <div style={styles.label}>
            {a.currentBidMinor != null
              ? pick(lang, 'أعلى مزايدة', 'Current bid', 'Enchère actuelle')
              : pick(lang, 'سعر البداية', 'Starting price', 'Prix de départ')}
          </div>
          <div style={styles.price}>{currentText}</div>
        </div>
        <div style={styles.metaCol}>
          <div>{pick(lang, 'عدد المزايدات', 'Bids', 'Enchères')}: <strong>{a.bidCount}</strong></div>
          {a.hasReserve && (
            <div style={{ color: a.reserveMet ? '#1e9e62' : '#a06a00' }}>
              {a.reserveMet
                ? pick(lang, 'تم بلوغ الحد الأدنى', 'Reserve met', 'Prix de réserve atteint')
                : pick(lang, 'لم يُبلغ الحد الأدنى', 'Reserve not met', 'Réserve non atteinte')}
            </div>
          )}
        </div>
      </div>

      {a.depositMode === 'REQUIRED' && isLive && (
        <div style={styles.depositNote}>
          {pick(
            lang,
            `تتطلب هذه المزايدة بطاقة محفوظة. العربون ${a.depositMinor != null ? moneyText(a.depositMinor, currency, lang) : ''} يُخصم من الفائز عند الإغلاق.`,
            `This auction requires a saved card. A deposit of ${a.depositMinor != null ? moneyText(a.depositMinor, currency, lang) : ''} is charged to the winner at close.`,
            `Cette enchère exige une carte. Un acompte de ${a.depositMinor != null ? moneyText(a.depositMinor, currency, lang) : ''} est débité au gagnant à la clôture.`,
          )}
        </div>
      )}

      {/* Seller view */}
      {a.viewerIsSeller && (
        <div style={styles.sellerBox}>
          <span>{pick(lang, 'أنت صاحب هذا المزاد.', 'You are the seller of this a.', 'Vous êtes le vendeur.')}</span>
          {isLive && (
            <div style={styles.btnRow}>
              <button type="button" style={styles.secondaryBtn} disabled={busy} onClick={sellerFinalize}>
                {pick(lang, 'إنهاء الآن', 'End now', 'Terminer')}
              </button>
              {a.bidCount === 0 && (
                <button type="button" style={styles.secondaryBtn} disabled={busy} onClick={sellerCancel}>
                  {pick(lang, 'إلغاء المزاد', 'Cancel auction', 'Annuler')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bidder view (live) */}
      {isLive && !a.viewerIsSeller && (
        <div style={styles.bidBox}>
          {a.viewerIsHighBidder && (
            <div style={styles.topBidderTag}>{pick(lang, 'أنت صاحب أعلى مزايدة', 'You are the top bidder', 'Vous êtes en tête')}</div>
          )}
          <label style={styles.label} htmlFor="auction-bid-input">
            {pick(lang, `أدخل مزايدتك (الحد الأدنى ${moneyText(a.minNextBidMinor, currency, lang)})`,
              `Your bid (min ${moneyText(a.minNextBidMinor, currency, lang)})`,
              `Votre enchère (min ${moneyText(a.minNextBidMinor, currency, lang)})`)}
          </label>
          <div style={styles.inputRow}>
            <input
              id="auction-bid-input"
              dir="ltr"
              inputMode="numeric"
              style={styles.input}
              value={amount}
              onChange={(e) => {
                amountTouched.current = true
                setAmount(e.target.value.replace(/[^0-9]/g, ''))
              }}
            />
            <span style={styles.currencyTag}>{currency}</span>
          </div>
          {signedIn ? (
            <button type="button" style={styles.primaryBtn} disabled={busy} onClick={submitBid}>
              {busy ? pick(lang, '...', '...', '...') : pick(lang, 'زايد الآن', 'Place bid', 'Enchérir')}
            </button>
          ) : (
            <button type="button" style={styles.primaryBtn} disabled={busy} onClick={goSignIn}>
              {pick(lang, 'سجّل الدخول للمزايدة', 'Sign in to bid', 'Connexion pour enchérir')}
            </button>
          )}
          {a.depositMode === 'REQUIRED' && signedIn && (
            <button type="button" style={styles.linkBtn} disabled={busy} onClick={addCardThenBid}>
              {pick(lang, 'أضف بطاقة للمزايدة', 'Add a card to bid', 'Ajouter une carte')}
            </button>
          )}
        </div>
      )}

      {/* Result (ended) */}
      {ended && (
        <div style={styles.resultBox}>
          {a.status === 'CANCELLED'
            ? pick(lang, 'أُلغي هذا المزاد.', 'This auction was cancelled.', 'Enchère annulée.')
            : a.winnerId
              ? a.viewerWon
                ? pick(lang, `لقد فزت! المزايدة الفائزة ${moneyText(a.winningBidMinor || 0, currency, lang)}. سيتواصل البائع معك.`,
                    `You won! Winning bid ${moneyText(a.winningBidMinor || 0, currency, lang)}. The seller will contact you.`,
                    `Vous avez gagné ! Enchère gagnante ${moneyText(a.winningBidMinor || 0, currency, lang)}.`)
                : pick(lang, `انتهى المزاد. المزايدة الفائزة ${moneyText(a.winningBidMinor || 0, currency, lang)}.`,
                    `Auction ended. Winning bid ${moneyText(a.winningBidMinor || 0, currency, lang)}.`,
                    `Enchère terminée. Enchère gagnante ${moneyText(a.winningBidMinor || 0, currency, lang)}.`)
              : pick(lang, 'انتهى المزاد دون بيع (لم يُبلغ الحد الأدنى).', 'Auction ended with no sale (reserve not met).', 'Terminée sans vente (réserve non atteinte).')}
        </div>
      )}

      {notice && <div style={styles.notice}>{notice}</div>}
      {error && <div style={styles.error}>{error}</div>}

      {/* Bid history */}
      {bids.length > 0 && (
        <details style={styles.history}>
          <summary style={styles.historySummary}>{pick(lang, `سجل المزايدات (${bids.length})`, `Bid history (${bids.length})`, `Historique (${bids.length})`)}</summary>
          <ul style={styles.historyList}>
            {bids.map((b) => (
              <li key={b.id} style={styles.historyItem}>
                <span>{b.isYou ? pick(lang, 'أنت', 'You', 'Vous') : b.bidderMasked}</span>
                <strong>{moneyText(b.amountMinor, b.currency, lang)}</strong>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { border: '1px solid #e4e9f2', borderRadius: 16, padding: 18, background: '#fbfcff', display: 'grid', gap: 12, marginBottom: 16 },
  headRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: { background: '#0b1b3b', color: '#fff', borderRadius: 999, padding: '4px 12px', fontWeight: 700, fontSize: 13 },
  timer: { fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  endedTag: { color: '#6b7280', fontWeight: 600 },
  priceRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 13, color: '#60708a' },
  price: { fontSize: 26, fontWeight: 800, color: '#0b1b3b' },
  metaCol: { display: 'grid', gap: 4, fontSize: 13, textAlign: 'end' as CSSProperties['textAlign'] },
  depositNote: { background: '#fff7e6', border: '1px solid #ffe2a8', borderRadius: 10, padding: 10, fontSize: 13, color: '#7a5600' },
  sellerBox: { background: '#eef2ff', borderRadius: 10, padding: 12, display: 'grid', gap: 10, fontSize: 14 },
  bidBox: { display: 'grid', gap: 8 },
  topBidderTag: { color: '#1e9e62', fontWeight: 700, fontSize: 13 },
  inputRow: { display: 'flex', alignItems: 'center', gap: 8 },
  input: { flex: 1, padding: '12px 14px', borderRadius: 10, border: '1px solid #c9d3e6', fontSize: 18, fontWeight: 700 },
  currencyTag: { fontWeight: 700, color: '#60708a' },
  primaryBtn: { padding: '12px 16px', borderRadius: 10, border: 'none', background: '#0b1b3b', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 15 },
  secondaryBtn: { padding: '10px 14px', borderRadius: 10, border: '1px solid #c9d3e6', background: '#fff', color: '#0b1b3b', fontWeight: 600, cursor: 'pointer' },
  linkBtn: { background: 'none', border: 'none', color: '#2b5cff', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 14, justifySelf: 'start' as CSSProperties['justifySelf'] },
  btnRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  resultBox: { background: '#f0f4ff', borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 600, color: '#0b1b3b' },
  notice: { color: '#1e9e62', fontSize: 13, fontWeight: 600 },
  error: { color: '#d14343', fontSize: 13, fontWeight: 600 },
  history: { borderTop: '1px solid #eef1f7', paddingTop: 8 },
  historySummary: { cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#60708a' },
  historyList: { listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 6 },
  historyItem: { display: 'flex', justifyContent: 'space-between', fontSize: 14 },
}
