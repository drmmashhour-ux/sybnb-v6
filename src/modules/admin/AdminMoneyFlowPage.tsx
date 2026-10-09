import { useEffect, useState, useCallback } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { moneyText } from '../../shared/i18n/display'
import {
  fetchAdminLedger,
  getStoredStaffSession,
  type PlatformLedgerResult,
} from '../../shared/api/platformApi'

type Props = { lang: Lang }

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

const TYPES = ['ALL', 'CREDIT', 'DEBIT', 'HOLD', 'RELEASE', 'REFUND'] as const

function typeTone(type: string): string {
  switch (type.toUpperCase()) {
    case 'CREDIT': return T.green
    case 'RELEASE': return T.cyan
    case 'DEBIT': return T.red
    case 'REFUND': return T.gold
    case 'HOLD': return T.muted
    default: return T.muted
  }
}

const PAGE_SIZE = 50

export function AdminMoneyFlowPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [data, setData] = useState<PlatformLedgerResult | null>(null)
  const [type, setType] = useState<string>('ALL')
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)

  const t = {
    title: pick(lang, 'حركة الأموال', 'Money flow', 'Flux financier'),
    subtitle: pick(lang, 'كل حركة مالية على المنصة: إيداع، سحب، تعليق، إفراج، واسترداد — مع صاحب الحساب والمرجع.', 'Every money movement on the platform: credits, debits, holds, releases, refunds — with the account and reference.', 'Chaque mouvement d’argent sur la plateforme, avec le compte et la référence.'),
    back: pick(lang, 'لوحة الإدارة', 'Admin dashboard', 'Tableau de bord'),
    searchPh: pick(lang, 'ابحث بالبريد أو الاسم أو المرجع…', 'Search by email, name, or reference…', 'Rechercher par e-mail, nom ou référence…'),
    search: pick(lang, 'بحث', 'Search', 'Rechercher'),
    moneyIn: pick(lang, 'إجمالي الإيداعات', 'Total credited', 'Total crédité'),
    moneyOut: pick(lang, 'إجمالي السحوبات', 'Total debited', 'Total débité'),
    refunds: pick(lang, 'الاستردادات', 'Refunds', 'Remboursements'),
    net: pick(lang, 'الصافي', 'Net flow', 'Flux net'),
    count: pick(lang, 'عدد الحركات', 'Transactions', 'Transactions'),
    account: pick(lang, 'الحساب', 'Account', 'Compte'),
    type: pick(lang, 'النوع', 'Type', 'Type'),
    amount: pick(lang, 'المبلغ', 'Amount', 'Montant'),
    reference: pick(lang, 'المرجع', 'Reference', 'Référence'),
    date: pick(lang, 'التاريخ', 'Date', 'Date'),
    none: pick(lang, 'لا توجد حركات مطابقة.', 'No matching transactions.', 'Aucune transaction correspondante.'),
    loading: pick(lang, 'جار التحميل…', 'Loading…', 'Chargement…'),
    prev: pick(lang, 'السابق', 'Previous', 'Précédent'),
    next: pick(lang, 'التالي', 'Next', 'Suivant'),
    showing: pick(lang, 'عرض', 'Showing', 'Affichage'),
  }

  const load = useCallback(async (opts: { type: string; q: string; offset: number }) => {
    setStatus('loading')
    setMessage('')
    try {
      const result = await fetchAdminLedger({
        limit: PAGE_SIZE,
        offset: opts.offset,
        type: opts.type === 'ALL' ? undefined : opts.type,
        q: opts.q || undefined,
      })
      setData(result)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void load({ type, q: query, offset })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, query, offset])

  const money = (minor: number) => moneyText(minor, 'SYP', lang)
  const fmtDateTime = (value: string) => {
    try {
      return new Date(value).toLocaleString(isAr ? 'ar' : lang === 'fr' ? 'fr' : 'en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch {
      return value.slice(0, 16).replace('T', ' ')
    }
  }

  const isStaff = Boolean(getStoredStaffSession('ADMIN'))
  const summary = data?.summary

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

      {!isStaff && <section style={{ ...styles.alert, background: 'linear-gradient(90deg, rgba(232,189,42,.14), rgba(232,189,42,.04))', borderColor: 'rgba(232,189,42,.4)', color: '#f3d672' }}>{pick(lang, 'سجّل الدخول كمسؤول لعرض حركة الأموال.', 'Sign in as admin to view money flow.', 'Connectez-vous en tant qu’admin.')}</section>}

      <section style={styles.statsRow}>
        <Stat label={t.moneyIn} value={summary ? money(summary.creditMinor) : '—'} tone={T.green} />
        <Stat label={t.moneyOut} value={summary ? money(summary.debitMinor) : '—'} tone={T.red} />
        <Stat label={t.refunds} value={summary ? money(summary.refundMinor) : '—'} tone={T.gold} />
        <Stat label={t.net} value={summary ? money(summary.netMinor) : '—'} tone={T.cyan} />
        <Stat label={t.count} value={summary ? String(summary.count) : '—'} tone={T.blue2} />
      </section>

      <section style={styles.toolbar}>
        <div style={styles.searchRow}>
          <input
            style={styles.input}
            placeholder={t.searchPh}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setOffset(0); setQuery(q) } }}
          />
          <button style={styles.blueBtn} onClick={() => { setOffset(0); setQuery(q) }}>{t.search}</button>
        </div>
        <div style={styles.filters}>
          {TYPES.map((ty) => (
            <button
              key={ty}
              style={{ ...styles.filter, ...(type === ty ? styles.filterActive : {}) }}
              onClick={() => { setOffset(0); setType(ty) }}
            >
              {ty === 'ALL' ? pick(lang, 'الكل', 'All', 'Tous') : ty}
            </button>
          ))}
        </div>
      </section>

      {status === 'error' && <section style={styles.alert}>{message}</section>}

      <section style={styles.tableCard}>
        <div style={{ ...styles.row, ...styles.headRow }}>
          <div style={styles.cell}>{t.type}</div>
          <div style={styles.cell}>{t.account}</div>
          <div style={styles.cell}>{t.amount}</div>
          <div style={styles.cell}>{t.reference}</div>
          <div style={styles.cell}>{t.date}</div>
        </div>
        {status === 'loading' && <div style={styles.infoRow}>{t.loading}</div>}
        {status === 'ready' && data && data.entries.length === 0 && <div style={styles.infoRow}>{t.none}</div>}
        {status === 'ready' && data && data.entries.map((e) => {
          const tone = typeTone(e.type)
          const outflow = e.type === 'DEBIT'
          return (
            <div key={e.id} style={styles.row}>
              <div style={styles.cell}><span style={{ ...styles.pill, color: tone, borderColor: tone }}>{e.type}</span></div>
              <div style={styles.cell}>
                {e.user ? (
                  <button style={styles.linkBtn} onClick={() => (window.location.hash = `/admin/customers/${encodeURIComponent(e.user!.id)}`)}>
                    {e.user.displayName}
                  </button>
                ) : <span style={{ color: T.dim }}>—</span>}
                {e.user?.email && <div style={{ color: T.dim, fontSize: 11 }}>{e.user.email}</div>}
              </div>
              <div style={{ ...styles.cell, color: tone, fontWeight: 800 }}>{outflow ? '−' : '+'}{money(e.amountMinor)}</div>
              <div style={styles.cell}>
                <span style={{ color: T.muted }}>{e.referenceType}</span>
                <div style={{ color: T.dim, fontSize: 11 }}>{e.note || e.referenceId.slice(0, 12)}</div>
              </div>
              <div style={{ ...styles.cell, color: T.dim }}>{fmtDateTime(e.createdAt)}</div>
            </div>
          )
        })}
      </section>

      {status === 'ready' && data && (
        <section style={styles.pager}>
          <button style={styles.ghostBtn} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>← {t.prev}</button>
          <span style={{ color: T.dim, fontSize: 13 }}>{t.showing} {offset + 1}–{offset + data.entries.length} / {data.summary.count}</span>
          <button style={styles.ghostBtn} disabled={!data.page.hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>{t.next} →</button>
        </section>
      )}
    </main>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <article style={styles.stat}>
      <small style={{ color: T.dim, fontWeight: 700, fontSize: 11.5 }}>{label}</small>
      <strong style={{ color: tone, fontSize: 20, fontWeight: 900 }}>{value}</strong>
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: 'radial-gradient(1000px 480px at 12% -8%, rgba(91,116,255,.14), transparent 60%), radial-gradient(820px 440px at 92% 2%, rgba(25,215,255,.08), transparent 55%), #070b16', color: T.text, padding: '28px 24px 90px', display: 'grid', gap: 18, maxWidth: 1180, margin: '0 auto', alignContent: 'start', fontFamily: 'inherit' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  eyebrow: { fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', color: T.dim, fontWeight: 800 },
  title: { margin: '6px 0 4px', fontSize: 28, letterSpacing: '-.01em' },
  subtitle: { margin: 0, color: T.muted, maxWidth: 720, lineHeight: 1.6 },
  ghostBtn: { minHeight: 44, border: `1px solid ${T.line}`, borderRadius: 12, background: 'rgba(130,150,200,.06)', color: T.text, padding: '0 16px', fontWeight: 700, cursor: 'pointer' },
  statsRow: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  stat: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, boxShadow: T.shadow, padding: 16, display: 'grid', gap: 8, minHeight: 84 },
  toolbar: { display: 'grid', gap: 12 },
  searchRow: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, maxWidth: 620 },
  input: { minHeight: 46, border: `1px solid ${T.lineStrong}`, borderRadius: 12, background: '#070b16', color: '#fff', padding: '0 14px', fontSize: 15, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  blueBtn: { minHeight: 46, border: 0, borderRadius: 12, background: `linear-gradient(135deg,${T.blue},#4254e0)`, color: '#fff', fontWeight: 800, padding: '0 20px', cursor: 'pointer', boxShadow: '0 10px 24px -16px rgba(91,116,255,.9)' },
  filters: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  filter: { minHeight: 38, border: `1px solid ${T.line}`, borderRadius: 999, background: 'rgba(130,150,200,.06)', color: T.muted, fontWeight: 700, padding: '0 15px', cursor: 'pointer', fontSize: 13 },
  filterActive: { border: '1px solid rgba(123,144,255,.6)', background: 'linear-gradient(135deg, rgba(91,116,255,.28), rgba(91,116,255,.12))', color: '#fff', boxShadow: '0 8px 22px -12px rgba(91,116,255,.9)' },
  tableCard: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: T.shadow, padding: 10, display: 'grid', gap: 2, overflow: 'hidden' },
  row: { display: 'grid', gridTemplateColumns: '110px 1.4fr 1fr 1.4fr 1fr', gap: 12, alignItems: 'center', padding: '12px 12px', borderRadius: 10 },
  headRow: { color: T.dim, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', borderBottom: `1px solid ${T.line}`, borderRadius: 0 },
  cell: { minWidth: 0, overflowWrap: 'anywhere', fontSize: 13.5 },
  infoRow: { padding: '18px 12px', color: T.dim },
  pill: { border: '1px solid', borderRadius: 999, fontSize: 10.5, fontWeight: 800, padding: '4px 10px', whiteSpace: 'nowrap' },
  linkBtn: { background: 'transparent', border: 0, color: T.blue2, fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 13.5, textAlign: 'start' },
  alert: { border: '1px solid rgba(255,92,122,.4)', borderRadius: 14, background: 'linear-gradient(90deg, rgba(255,92,122,.16), rgba(255,92,122,.05))', color: '#ffd1d9', padding: '15px 18px' },
  pager: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
}

export default AdminMoneyFlowPage
