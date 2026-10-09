import { useEffect, useState, useCallback } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { moneyText } from '../../shared/i18n/display'
import {
  lookupAdminUser,
  fetchAdminUserOverview,
  getStoredStaffSession,
  type PlatformAdminUserOverview,
  type PlatformAdminOverviewBooking,
} from '../../shared/api/platformApi'

type Props = { lang: Lang }

// Shared admin design tokens — mirrors the refreshed admin console look.
const T = {
  panel: 'linear-gradient(180deg,#111b2e,#0c1322)',
  line: 'rgba(130,150,200,.14)',
  lineStrong: 'rgba(130,150,200,.22)',
  shadow: '0 1px 0 rgba(255,255,255,.05) inset, 0 18px 40px -22px rgba(0,0,0,.8)',
  text: '#f2f5ff',
  muted: '#9aa7bd',
  dim: '#6c7b96',
  blue: '#5b74ff',
  blue2: '#7d90ff',
  cyan: '#19d7ff',
  gold: '#e8bd2a',
  green: '#22d6a0',
  red: '#ff5c7a',
}

function statusTone(status: string): string {
  const s = status.toUpperCase()
  if (s.includes('APPROV') || s.includes('PAID') || s.includes('CONFIRM') || s.includes('ACTIVE') || s.includes('COMPLETED') || s.includes('SENT') || s.includes('CLAIMED')) return T.green
  if (s.includes('REJECT') || s.includes('CANCEL') || s.includes('BLOCK') || s.includes('SUSPEND') || s.includes('DELETE') || s.includes('DISPUT') || s.includes('FAIL')) return T.red
  if (s.includes('PENDING') || s.includes('REQUEST') || s.includes('HOLD') || s.includes('DRAFT') || s.includes('PROOF') || s.includes('REVIEW')) return T.gold
  return T.muted
}

export function AdminCustomerPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const initialId = (() => {
    const m = window.location.hash.replace(/^#/, '').match(/^\/admin\/customers\/([^/]+)$/)
    return m ? decodeURIComponent(m[1]) : ''
  })()

  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(initialId ? 'loading' : 'idle')
  const [message, setMessage] = useState('')
  const [data, setData] = useState<PlatformAdminUserOverview | null>(null)

  const t = {
    title: pick(lang, 'ملف العميل الشامل', 'Customer 360', 'Client 360'),
    subtitle: pick(lang, 'كل سجل الحساب في مكان واحد: الإعلانات، الحجوزات، المدفوعات، الصرف، المحفظة، والهدايا.', 'Everything about one account in one place: listings, bookings, payments, payouts, wallet, and gifts.', 'Tout un compte au même endroit : annonces, réservations, paiements, versements, portefeuille et cadeaux.'),
    back: pick(lang, 'لوحة الإدارة', 'Admin dashboard', 'Tableau de bord'),
    searchLabel: pick(lang, 'ابحث عن عميل بالبريد أو الهاتف أو الاسم', 'Find a customer by email, phone, or name', 'Rechercher un client par e-mail, téléphone ou nom'),
    search: pick(lang, 'بحث', 'Search', 'Rechercher'),
    loading: pick(lang, 'جار التحميل…', 'Loading…', 'Chargement…'),
    notFound: pick(lang, 'لا يوجد حساب بهذا البريد أو الهاتف أو الاسم.', 'No account found for that email, phone, or name.', 'Aucun compte trouvé pour cet e-mail, téléphone ou nom.'),
    member: pick(lang, 'عضو منذ', 'Member since', 'Membre depuis'),
    spent: pick(lang, 'إجمالي ما دفعه', 'Lifetime spent', 'Total dépensé'),
    earned: pick(lang, 'إجمالي المصروف له', 'Lifetime payouts', 'Versements totaux'),
    wallet: pick(lang, 'رصيد المحفظة', 'Wallet balance', 'Solde du portefeuille'),
    listings: pick(lang, 'الإعلانات', 'Listings', 'Annonces'),
    bookingsGuest: pick(lang, 'الحجوزات (كعميل)', 'Bookings (as guest)', 'Réservations (client)'),
    bookingsHost: pick(lang, 'الحجوزات (كمضيف)', 'Bookings (as host)', 'Réservations (hôte)'),
    payments: pick(lang, 'المدفوعات', 'Payments', 'Paiements'),
    payouts: pick(lang, 'طلبات الصرف', 'Payout requests', 'Demandes de versement'),
    walletEntries: pick(lang, 'حركات المحفظة', 'Wallet ledger', 'Mouvements du portefeuille'),
    giftsSent: pick(lang, 'الهدايا المُرسلة', 'Gifts sent', 'Cadeaux envoyés'),
    giftsReceived: pick(lang, 'الهدايا المستلمة', 'Gifts received', 'Cadeaux reçus'),
    audit: pick(lang, 'سجل الإدارة المتعلق', 'Related admin audit', 'Journal d’audit lié'),
    none: pick(lang, 'لا يوجد', 'None', 'Aucun'),
    verified: pick(lang, 'مضيف موثّق', 'Verified host', 'Hôte vérifié'),
    unverified: pick(lang, 'غير موثّق', 'Unverified', 'Non vérifié'),
  }

  const loadById = useCallback(async (userId: string) => {
    setStatus('loading')
    setMessage('')
    try {
      const overview = await fetchAdminUserOverview(userId)
      setData(overview)
      setStatus('ready')
      window.location.hash = `/admin/customers/${encodeURIComponent(userId)}`
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    if (initialId) void loadById(initialId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSearch() {
    // Don't lowercase — the value may be a name or phone; the server lowercases email itself.
    const trimmed = email.trim()
    if (!trimmed) return
    setStatus('loading')
    setMessage('')
    try {
      const user = await lookupAdminUser(trimmed)
      await loadById(user.id)
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const fmtDate = (value: string | null) => {
    if (!value) return '—'
    try {
      return new Date(value).toLocaleDateString(isAr ? 'ar' : lang === 'fr' ? 'fr' : 'en', { year: 'numeric', month: 'short', day: 'numeric' })
    } catch {
      return value.slice(0, 10)
    }
  }
  const money = (minor: number, currency: string) => moneyText(minor, currency, lang)
  const bookingTitle = (b: PlatformAdminOverviewBooking) => (isAr ? b.listing?.titleAr : b.listing?.titleEn || b.listing?.titleAr) || b.listingId.slice(0, 8)

  const isStaff = Boolean(getStoredStaffSession('ADMIN'))

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <header style={styles.header}>
        <div>
          <span style={styles.eyebrow}>SYBNB · ADMIN</span>
          <h1 style={styles.title}>{t.title}</h1>
          <p style={styles.subtitle}>{t.subtitle}</p>
        </div>
        <button style={styles.ghostBtn} onClick={() => (window.location.hash = '/admin/review')}>← {t.back}</button>
      </header>

      <section style={styles.searchCard}>
        <label style={styles.searchLabel}>{t.searchLabel}</label>
        <div style={styles.searchRow}>
          <input
            style={styles.input}
            type="text"
            placeholder={pick(lang, 'بريد، هاتف، أو اسم', 'Email, phone, or name', 'E-mail, téléphone ou nom')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void onSearch() }}
          />
          <button style={styles.blueBtn} onClick={() => void onSearch()} disabled={status === 'loading'}>{t.search}</button>
        </div>
        {!isStaff && <small style={{ color: T.gold }}>{pick(lang, 'سجّل الدخول كمسؤول لعرض بيانات العملاء.', 'Sign in as admin to view customer data.', 'Connectez-vous en tant qu’admin.')}</small>}
      </section>

      {status === 'loading' && <section style={styles.infoCard}>{t.loading}</section>}
      {status === 'error' && <section style={styles.alert}>{message || t.notFound}</section>}

      {status === 'ready' && data && (
        <>
          <section style={styles.profileCard}>
            <div style={styles.profileRow}>
              <span style={styles.avatar}>{(data.user.displayName || '?').slice(0, 1).toUpperCase()}</span>
              <div style={{ display: 'grid', gap: 4 }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>{data.user.displayName}</h2>
                <small style={{ color: T.muted }}>{data.user.email || '—'}</small>
                <div style={styles.badgeRow}>
                  <span style={{ ...styles.badge, color: statusTone(data.user.status), borderColor: statusTone(data.user.status) }}>{data.user.status}</span>
                  <span style={{ ...styles.badge, color: data.user.hostVerifiedAt ? T.green : T.dim, borderColor: data.user.hostVerifiedAt ? T.green : T.line }}>{data.user.hostVerifiedAt ? t.verified : t.unverified}</span>
                  {data.user.roles.map((r) => <span key={r} style={{ ...styles.badge, color: T.blue2, borderColor: 'rgba(123,144,255,.4)' }}>{r}</span>)}
                </div>
              </div>
            </div>
            <div style={{ color: T.dim, fontSize: 12 }}>{t.member} {fmtDate(data.user.createdAt)}</div>
          </section>

          <section style={styles.statsRow}>
            <Stat label={t.spent} value={money(data.totals.lifetimeSpentMinor, 'SYP')} tone={T.green} />
            <Stat label={t.earned} value={money(data.totals.lifetimePayoutMinor, 'SYP')} tone={T.blue2} />
            <Stat label={t.wallet} value={money(data.totals.walletBalanceMinor, 'SYP')} tone={T.gold} />
            <Stat label={t.listings} value={String(data.totals.listingsCount)} tone={T.cyan} />
          </section>

          <Section title={t.listings} count={data.listings.length} empty={t.none}>
            {data.listings.map((l) => (
              <Row key={l.id} cols={[
                <strong>{(isAr ? l.titleAr : l.titleEn || l.titleAr) || l.id.slice(0, 8)}</strong>,
                <span style={{ color: T.dim }}>{l.division}</span>,
                <span>{money(l.priceMinor, l.currency)}</span>,
                <Pill text={l.status} />,
                <span style={{ color: T.dim }}>{fmtDate(l.createdAt)}</span>,
              ]} />
            ))}
          </Section>

          <Section title={t.bookingsGuest} count={data.bookingsAsGuest.length} empty={t.none}>
            {data.bookingsAsGuest.map((b) => (
              <Row key={b.id} cols={[
                <strong>{bookingTitle(b)}</strong>,
                <span style={{ color: T.dim }}>{fmtDate(b.checkIn)} → {fmtDate(b.checkOut)}</span>,
                <span>{money(b.amountMinor, b.currency)}</span>,
                <Pill text={b.status} />,
                <span style={{ color: T.dim }}>{fmtDate(b.createdAt)}</span>,
              ]} />
            ))}
          </Section>

          <Section title={t.bookingsHost} count={data.bookingsAsHost.length} empty={t.none}>
            {data.bookingsAsHost.map((b) => (
              <Row key={b.id} cols={[
                <strong>{bookingTitle(b)}</strong>,
                <span style={{ color: T.dim }}>{fmtDate(b.checkIn)} → {fmtDate(b.checkOut)}</span>,
                <span>{money(b.amountMinor, b.currency)}</span>,
                <Pill text={b.status} />,
                <span style={{ color: T.dim }}>{fmtDate(b.createdAt)}</span>,
              ]} />
            ))}
          </Section>

          <Section title={t.payments} count={data.payments.length} empty={t.none}>
            {data.payments.map((p) => (
              <Row key={p.id} cols={[
                <strong>{p.provider}</strong>,
                <span style={{ color: T.dim }}>{p.bookingId ? p.bookingId.slice(0, 8) : '—'}</span>,
                <span>{money(p.amountMinor, p.currency)}</span>,
                <Pill text={p.status} />,
                <span style={{ color: T.dim }}>{fmtDate(p.createdAt)}</span>,
              ]} />
            ))}
          </Section>

          <Section title={t.payouts} count={data.payouts.length} empty={t.none}>
            {data.payouts.map((p) => (
              <Row key={p.id} cols={[
                <strong>{money(p.amountMinor, p.currency)}</strong>,
                <Pill text={p.status} />,
                <span style={{ color: T.dim }}>{fmtDate(p.createdAt)}</span>,
                <span style={{ color: T.dim }}>{p.decidedAt ? fmtDate(p.decidedAt) : '—'}</span>,
              ]} />
            ))}
          </Section>

          <Section title={t.walletEntries} count={data.wallets.reduce((s, w) => s + w.entries.length, 0)} empty={t.none}>
            {data.wallets.flatMap((w) => w.entries.map((e) => (
              <Row key={e.id} cols={[
                <span style={{ color: e.type === 'DEBIT' ? T.red : T.green, fontWeight: 800 }}>{e.type}</span>,
                <span>{money(e.amountMinor, e.currency)}</span>,
                <span style={{ color: T.dim }}>{e.referenceType}</span>,
                <span style={{ color: T.dim, fontSize: 12 }}>{e.note || e.referenceId.slice(0, 8)}</span>,
                <span style={{ color: T.dim }}>{fmtDate(e.createdAt)}</span>,
              ]} />
            )))}
          </Section>

          {(data.giftsSent.length > 0 || data.giftsReceived.length > 0) && (
            <Section title={`${t.giftsSent} / ${t.giftsReceived}`} count={data.giftsSent.length + data.giftsReceived.length} empty={t.none}>
              {data.giftsSent.map((g) => (
                <Row key={`s-${g.id}`} cols={[<span style={{ color: T.gold }}>↗ {t.giftsSent}</span>, <span>{money(g.amountMinor, g.currency)}</span>, <Pill text={g.status} />, <span style={{ color: T.dim }}>{fmtDate(g.createdAt)}</span>]} />
              ))}
              {data.giftsReceived.map((g) => (
                <Row key={`r-${g.id}`} cols={[<span style={{ color: T.cyan }}>↙ {t.giftsReceived}</span>, <span>{money(g.amountMinor, g.currency)}</span>, <Pill text={g.status} />, <span style={{ color: T.dim }}>{fmtDate(g.createdAt)}</span>]} />
              ))}
            </Section>
          )}

          <Section title={t.audit} count={data.audit.length} empty={t.none}>
            {data.audit.map((a) => (
              <Row key={a.id} cols={[
                <strong style={{ color: T.blue2 }}>{a.action}</strong>,
                <span style={{ color: T.dim }}>{a.entityType}</span>,
                <span style={{ color: T.dim }}>{fmtDate(a.createdAt)}</span>,
              ]} />
            ))}
          </Section>
        </>
      )}
    </main>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <article style={styles.stat}>
      <small style={{ color: T.dim, fontWeight: 700, fontSize: 11.5 }}>{label}</small>
      <strong style={{ color: tone, fontSize: 21, fontWeight: 900 }}>{value}</strong>
    </article>
  )
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHead}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{title}</h2>
        <span style={styles.countBadge}>{count}</span>
      </div>
      {count === 0 ? <p style={{ color: T.dim, margin: 0 }}>{empty}</p> : <div style={styles.rows}>{children}</div>}
    </section>
  )
}

function Row({ cols }: { cols: ReactNode[] }) {
  return (
    <div style={styles.row}>
      {cols.map((c, i) => <div key={i} style={styles.cell}>{c}</div>)}
    </div>
  )
}

function Pill({ text }: { text: string }) {
  const tone = statusTone(text)
  return <span style={{ ...styles.pill, color: tone, borderColor: tone, background: 'transparent' }}>{text}</span>
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: 'radial-gradient(1000px 480px at 12% -8%, rgba(91,116,255,.14), transparent 60%), radial-gradient(820px 440px at 92% 2%, rgba(25,215,255,.08), transparent 55%), #070b16', color: T.text, padding: '28px 24px 90px', display: 'grid', gap: 18, maxWidth: 1180, margin: '0 auto', alignContent: 'start', fontFamily: 'inherit' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  eyebrow: { fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', color: T.dim, fontWeight: 800 },
  title: { margin: '6px 0 4px', fontSize: 28, letterSpacing: '-.01em' },
  subtitle: { margin: 0, color: T.muted, maxWidth: 680, lineHeight: 1.6 },
  ghostBtn: { minHeight: 44, border: `1px solid ${T.line}`, borderRadius: 12, background: 'rgba(130,150,200,.06)', color: T.text, padding: '0 16px', fontWeight: 700, cursor: 'pointer' },
  searchCard: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: T.shadow, padding: 18, display: 'grid', gap: 10 },
  searchLabel: { color: T.muted, fontSize: 13, fontWeight: 700 },
  searchRow: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, maxWidth: 560 },
  input: { minHeight: 46, border: `1px solid ${T.lineStrong}`, borderRadius: 12, background: '#070b16', color: '#fff', padding: '0 14px', fontSize: 15, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  blueBtn: { minHeight: 46, border: 0, borderRadius: 12, background: `linear-gradient(135deg,${T.blue},#4254e0)`, color: '#fff', fontWeight: 800, padding: '0 20px', cursor: 'pointer', boxShadow: '0 10px 24px -16px rgba(91,116,255,.9)' },
  infoCard: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: 18, color: T.muted },
  alert: { border: '1px solid rgba(255,92,122,.4)', borderRadius: 14, background: 'linear-gradient(90deg, rgba(255,92,122,.16), rgba(255,92,122,.05))', color: '#ffd1d9', padding: '15px 18px' },
  profileCard: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: T.shadow, padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  profileRow: { display: 'flex', alignItems: 'center', gap: 15 },
  avatar: { width: 54, height: 54, borderRadius: 15, display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 22, color: '#0b1020', background: 'linear-gradient(135deg,#e7d2ad,#9a7f55)', boxShadow: '0 0 0 1px rgba(255,255,255,.15) inset' },
  badgeRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 },
  badge: { border: '1px solid', borderRadius: 999, fontSize: 11, fontWeight: 800, padding: '3px 10px' },
  statsRow: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' },
  stat: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, boxShadow: T.shadow, padding: 16, display: 'grid', gap: 8, minHeight: 86 },
  section: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: T.shadow, padding: 18, display: 'grid', gap: 12 },
  sectionHead: { display: 'flex', alignItems: 'center', gap: 10 },
  countBadge: { background: 'rgba(130,150,200,.1)', border: `1px solid ${T.line}`, borderRadius: 8, color: T.muted, fontSize: 12, fontWeight: 800, minWidth: 26, height: 22, display: 'inline-grid', placeItems: 'center', padding: '0 7px' },
  rows: { display: 'grid', gap: 8 },
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, alignItems: 'center', background: '#0c1322', border: `1px solid ${T.line}`, borderRadius: 12, padding: '12px 14px' },
  cell: { minWidth: 0, overflowWrap: 'anywhere', fontSize: 13.5 },
  pill: { border: '1px solid', borderRadius: 999, fontSize: 11, fontWeight: 800, padding: '4px 10px', whiteSpace: 'nowrap', justifySelf: 'start' },
}

export default AdminCustomerPage
