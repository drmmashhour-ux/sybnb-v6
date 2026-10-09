import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  fetchAdminHosts,
  issueHostActivationCode,
  type AdminHost,
  type AdminHostCodeState,
  type AdminHostFilter,
  type IssuedHostActivationCode,
} from '../../shared/api/platformApi'
import { localeForLang } from '../../shared/country/presentation'

type Props = { lang: Lang }

// Admin host verification desk (owner decision 2026-10-08, like Booking.com's partner PIN). A host's
// stays are hidden and unbookable until they enter a 6-digit activation code. The team contacts the
// host, generates the code here (shown ONCE -- only a hash is kept on the server), and gives it to
// them by phone/message, or ticks "send it by email too".

function formatDate(value: string | null | undefined, lang: Lang, withTime = false) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(pick(lang, localeForLang('ar'), localeForLang('en'), 'fr-CA'), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function codeStateLabel(state: AdminHostCodeState, lang: Lang) {
  switch (state) {
    case 'ACTIVE':
      return pick(lang, 'رمز صالح بانتظار الإدخال', 'Code waiting to be entered', 'Code en attente de saisie')
    case 'LOCKED':
      return pick(lang, 'الرمز مقفل (5 محاولات خاطئة)', 'Code locked (5 wrong attempts)', 'Code bloqué (5 essais erronés)')
    case 'EXPIRED':
      return pick(lang, 'الرمز منتهي أو مستبدل', 'Code expired or replaced', 'Code expiré ou remplacé')
    case 'USED':
      return pick(lang, 'تم استخدام الرمز', 'Code used', 'Code utilisé')
    default:
      return pick(lang, 'لم يُنشأ رمز بعد', 'No code yet', 'Aucun code')
  }
}

export function AdminHostsPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const colon = lang === 'fr' ? ' : ' : ': '
  const [filter, setFilter] = useState<AdminHostFilter>('unverified')
  const [query, setQuery] = useState('')
  const [hosts, setHosts] = useState<AdminHost[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [sendEmail, setSendEmail] = useState<Record<string, boolean>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [issued, setIssued] = useState<Record<string, IssuedHostActivationCode>>({})
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    void load(filter, query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  async function load(status: AdminHostFilter, q: string) {
    setState('loading')
    try {
      setHosts(await fetchAdminHosts(status, q))
      setState('ready')
    } catch (error) {
      setState('error')
      setLoadError(errorText(error))
    }
  }

  async function generate(host: AdminHost) {
    setBusyId(host.id)
    setRowError((current) => ({ ...current, [host.id]: '' }))
    try {
      const result = await issueHostActivationCode(host.id, Boolean(sendEmail[host.id]))
      setIssued((current) => ({ ...current, [host.id]: result }))
      setHosts((current) =>
        current.map((row) =>
          row.id === host.id
            ? { ...row, latestCode: { issuedAt: result.issuedAt, expiresAt: result.expiresAt, used: false, usedAt: null, attempts: 0, state: 'ACTIVE' } }
            : row,
        ),
      )
    } catch (error) {
      setRowError((current) => ({ ...current, [host.id]: errorText(error) }))
    } finally {
      setBusyId(null)
    }
  }

  async function copy(hostId: string, code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedId(hostId)
      window.setTimeout(() => setCopiedId((current) => (current === hostId ? null : current)), 2000)
    } catch {
      /* clipboard blocked: the code stays visible to copy by hand */
    }
  }

  const filters: Array<[AdminHostFilter, string]> = [
    ['unverified', pick(lang, 'بانتظار التحقق', 'Unverified', 'Non vérifiés')],
    ['verified', pick(lang, 'موثّقون', 'Verified', 'Vérifiés')],
    ['all', pick(lang, 'الكل', 'All', 'Tous')],
  ]

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <div style={styles.topLinks}>
        <button style={styles.back} onClick={() => (window.location.hash = '/admin/review')}>
          {pick(lang, 'العودة للمراجعة', 'Back to review', 'Retour à la vérification')}
        </button>
        <button style={styles.back} onClick={() => (window.location.hash = '/admin/money')}>
          {pick(lang, 'الصرف والاسترداد', 'Payouts & refunds', 'Versements et remboursements')}
        </button>
      </div>

      <section style={styles.hero}>
        <h1 style={styles.title}>{pick(lang, 'التحقق من المضيفين', 'Host verification', 'Vérification des hôtes')}</h1>
        <p style={styles.body}>
          {pick(
            lang,
            'لا تظهر إقامات المضيف للضيوف ولا يمكن حجزها قبل أن يُدخل رمز التفعيل. تواصل مع المضيف، أنشئ الرمز هنا وأعطه له. يظهر الرمز مرة واحدة فقط وصالح 7 أيام، و5 محاولات خاطئة تقفله.',
            'A host’s stays are hidden from guests and cannot be booked until they enter their activation code. Contact the host, generate the code here and give it to them. The code is shown only once, is valid for 7 days, and 5 wrong attempts lock it.',
            'Les logements d’un hôte sont masqués et non réservables tant qu’il n’a pas saisi son code d’activation. Contactez l’hôte, générez le code ici et transmettez-le-lui. Le code n’est affiché qu’une fois, valable 7 jours ; 5 essais erronés le bloquent.',
          )}
        </p>
      </section>

      <section style={styles.card} aria-labelledby="admin-hosts-list">
        <div style={styles.cardHead}>
          <h2 id="admin-hosts-list" style={styles.cardTitle}>{pick(lang, 'المضيفون', 'Hosts', 'Hôtes')}</h2>
          <div style={styles.filters} role="tablist">
            {filters.map(([value, label]) => (
              <button key={value} role="tab" aria-selected={filter === value} style={filter === value ? styles.filterActive : styles.filter} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <form
          style={styles.search}
          onSubmit={(event) => {
            event.preventDefault()
            void load(filter, query)
          }}
        >
          <input
            style={styles.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={pick(lang, 'ابحث بالاسم أو البريد', 'Search by name or email', 'Rechercher par nom ou courriel')}
            aria-label={pick(lang, 'ابحث بالاسم أو البريد', 'Search by name or email', 'Rechercher par nom ou courriel')}
          />
          <button type="submit" style={styles.secondaryButton}>{pick(lang, 'بحث', 'Search', 'Rechercher')}</button>
        </form>

        {state === 'loading' && <p style={styles.muted}>{pick(lang, 'جار التحميل...', 'Loading...', 'Chargement...')}</p>}
        {state === 'error' && <p style={styles.alert}>{loadError}</p>}
        {state === 'ready' && hosts.length === 0 && (
          <p style={styles.muted}>
            {filter === 'unverified'
              ? pick(lang, 'لا يوجد مضيفون بانتظار التحقق.', 'No hosts are waiting for verification.', 'Aucun hôte en attente de vérification.')
              : pick(lang, 'لا توجد نتائج.', 'No results.', 'Aucun résultat.')}
          </p>
        )}

        <div style={styles.list}>
          {hosts.map((host) => {
            const fresh = issued[host.id]
            return (
              <article key={host.id} style={styles.row}>
                <div style={styles.rowGrid}>
                  <div style={styles.cell}>
                    <small style={styles.label}>{pick(lang, 'المضيف', 'Host', 'Hôte')}</small>
                    <strong>{host.displayName || host.id.slice(0, 8).toUpperCase()}</strong>
                    {host.email && <small style={styles.muted} dir="ltr">{host.email}</small>}
                    <small style={styles.muted}>
                      {pick(lang, 'منذ', 'Joined', 'Inscrit le')} {formatDate(host.createdAt, lang)}
                    </small>
                  </div>
                  <div style={styles.cell}>
                    <small style={styles.label}>{pick(lang, 'الإعلانات', 'Listings', 'Annonces')}</small>
                    <strong>{host.listingsCount}</strong>
                  </div>
                  <div style={styles.cell}>
                    <small style={styles.label}>{pick(lang, 'رمز التفعيل', 'Activation code', 'Code d’activation')}</small>
                    <span>{codeStateLabel(host.latestCode?.state || 'NONE', lang)}</span>
                    {host.latestCode && (
                      <small style={styles.muted}>
                        {pick(lang, 'أُنشئ', 'Issued', 'Émis le')} {formatDate(host.latestCode.issuedAt, lang)}
                        {host.latestCode.state === 'ACTIVE' && (
                          <>
                            {' · '}
                            {pick(lang, 'ينتهي', 'expires', 'expire le')} {formatDate(host.latestCode.expiresAt, lang)}
                          </>
                        )}
                      </small>
                    )}
                  </div>
                  <div style={{ ...styles.cell, justifyItems: 'end' }}>
                    {host.verifiedAt ? (
                      <>
                        <span style={{ ...styles.pill, ...styles.pillOk }}>{pick(lang, 'موثّق ✓', 'Verified ✓', 'Vérifié ✓')}</span>
                        <small style={styles.muted}>{formatDate(host.verifiedAt, lang)}</small>
                      </>
                    ) : (
                      <span style={{ ...styles.pill, ...styles.pillPending }}>{pick(lang, 'بانتظار التحقق', 'Unverified', 'Non vérifié')}</span>
                    )}
                  </div>
                </div>

                {fresh && (
                  <div style={styles.codeBox} role="status" aria-live="polite">
                    <small style={styles.label}>{pick(lang, 'رمز التفعيل — يظهر مرة واحدة فقط', 'Activation code — shown only once', 'Code d’activation — affiché une seule fois')}</small>
                    <div style={styles.codeRow}>
                      <strong style={styles.code} dir="ltr" aria-label={fresh.code.split('').join(' ')}>
                        {fresh.code.slice(0, 3)} {fresh.code.slice(3)}
                      </strong>
                      <button style={styles.copyButton} onClick={() => void copy(host.id, fresh.code)}>
                        {copiedId === host.id ? pick(lang, 'تم النسخ ✓', 'Copied ✓', 'Copié ✓') : pick(lang, 'نسخ', 'Copy', 'Copier')}
                      </button>
                    </div>
                    <small style={styles.muted}>
                      {pick(lang, 'صالح حتى', 'Valid until', 'Valable jusqu’au')}
                      {colon}
                      {formatDate(fresh.expiresAt, lang, true)} · {fresh.maxAttempts} {pick(lang, 'محاولات', 'attempts', 'essais')}
                      {fresh.emailQueued ? ` · ${pick(lang, 'أُرسل أيضاً بالبريد', 'also sent by email', 'envoyé aussi par courriel')}` : ''}
                    </small>
                    <small style={styles.warn}>
                      {pick(
                        lang,
                        'أعطِ الرمز للمضيف نفسه فقط، بعد التأكد من هويته. إنشاء رمز جديد يلغي هذا الرمز.',
                        'Give the code only to the host in person, after confirming who they are. Generating a new code cancels this one.',
                        'Ne donnez le code qu’à l’hôte lui-même, après avoir vérifié son identité. Générer un nouveau code annule celui-ci.',
                      )}
                    </small>
                  </div>
                )}

                {!host.verifiedAt && (
                  <div style={styles.actions}>
                    <button style={styles.acceptButton} disabled={busyId === host.id} onClick={() => void generate(host)}>
                      {busyId === host.id
                        ? pick(lang, 'جار الإنشاء...', 'Generating...', 'Génération...')
                        : host.latestCode && host.latestCode.state !== 'NONE'
                          ? pick(lang, 'إنشاء رمز تفعيل جديد', 'Generate a new activation code', 'Générer un nouveau code d’activation')
                          : pick(lang, 'إنشاء رمز تفعيل', 'Generate activation code', 'Générer un code d’activation')}
                    </button>
                    <label style={styles.checkbox}>
                      <input
                        type="checkbox"
                        checked={Boolean(sendEmail[host.id])}
                        disabled={!host.email}
                        onChange={(event) => setSendEmail((current) => ({ ...current, [host.id]: event.target.checked }))}
                      />
                      <span>{pick(lang, 'أرسله بالبريد أيضاً', 'Send it by email too', 'L’envoyer aussi par courriel')}</span>
                    </label>
                  </div>
                )}
                {rowError[host.id] && <p style={styles.alert}>{rowError[host.id]}</p>}
              </article>
            )
          })}
        </div>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '32px 16px 90px', display: 'grid', gap: 20, maxWidth: 1180, margin: '0 auto', alignContent: 'start' },
  topLinks: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  back: { minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900, cursor: 'pointer' },
  hero: { border: '1px solid #1e1e2a', borderRadius: 8, padding: 18, background: '#111118', display: 'grid', gap: 10 },
  title: { margin: 0, fontSize: 28 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  muted: { color: '#8d92a2', margin: 0 },
  label: { color: '#8d92a2', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3 },
  card: { border: '1px solid #242735', borderRadius: 10, background: '#101016', padding: 18, display: 'grid', gap: 14, minWidth: 0 },
  cardHead: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { margin: 0, fontSize: 20 },
  filters: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  filter: { minHeight: 36, border: '1px solid #30384d', borderRadius: 999, background: '#171b29', color: '#c8cfdd', fontWeight: 800, padding: '0 14px', cursor: 'pointer' },
  filterActive: { minHeight: 36, border: '1px solid #20d29b', borderRadius: 999, background: 'rgba(32,210,155,.14)', color: '#b7ffe8', fontWeight: 950, padding: '0 14px', cursor: 'pointer' },
  search: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, maxWidth: 520 },
  input: { minHeight: 42, width: '100%', boxSizing: 'border-box', border: '1px solid #30384d', borderRadius: 8, background: '#0a0f1a', color: '#fff', padding: '0 12px', fontSize: 15, fontFamily: 'inherit' },
  list: { display: 'grid', gap: 10 },
  row: { border: '1px solid #242735', borderRadius: 8, background: '#0c1220', padding: 14, display: 'grid', gap: 12 },
  rowGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', alignItems: 'start' },
  cell: { display: 'grid', gap: 4, minWidth: 0, overflowWrap: 'anywhere', alignContent: 'start' },
  actions: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' },
  checkbox: { display: 'inline-flex', gap: 8, alignItems: 'center', color: '#c8cfdd', fontWeight: 700, cursor: 'pointer' },
  acceptButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 16px', cursor: 'pointer' },
  secondaryButton: { minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px', cursor: 'pointer' },
  codeBox: { border: '1px solid rgba(32,210,155,.5)', borderRadius: 10, background: 'rgba(32,210,155,.08)', padding: 16, display: 'grid', gap: 8 },
  codeRow: { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' },
  code: { fontSize: 'clamp(36px, 8vw, 52px)', letterSpacing: 6, fontWeight: 950, color: '#b7ffe8', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 },
  copyButton: { minHeight: 42, border: '1px solid #20d29b', borderRadius: 8, background: 'transparent', color: '#20d29b', fontWeight: 950, padding: '0 16px', cursor: 'pointer' },
  warn: { color: '#e5b80b', fontWeight: 700 },
  pill: { borderRadius: 999, padding: '4px 12px', fontWeight: 900, fontSize: 12, whiteSpace: 'nowrap' },
  pillPending: { background: 'rgba(229,184,11,.13)', color: '#e5b80b', border: '1px solid rgba(229,184,11,.42)' },
  pillOk: { background: 'rgba(32,210,155,.14)', color: '#20d29b', border: '1px solid rgba(32,210,155,.42)' },
  alert: { margin: 0, border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 12 },
}
