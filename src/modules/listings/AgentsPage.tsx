import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { moneyText } from '../../shared/i18n/display'
import { fetchAgent, fetchAgents, type PlatformAgent, type PlatformListing } from '../../shared/api/platformApi'

type Props = { lang: Lang; agentId?: string }

function typeLabel(t: string, lang: Lang): string {
  switch (String(t || '').toLowerCase()) {
    case 'broker': return pick(lang, 'وسيط عقاري', 'Broker', 'Courtier')
    case 'agency': return pick(lang, 'وكالة', 'Agency', 'Agence')
    case 'developer': return pick(lang, 'مطوّر عقاري', 'Developer', 'Promoteur')
    default: return t
  }
}

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0] || '').join('').toUpperCase() || '•'
}

export function AgentsPage({ lang, agentId }: Props) {
  const isAr = lang === 'ar'
  if (agentId) return <AgentProfile lang={lang} agentId={agentId} />

  const [agents, setAgents] = useState<PlatformAgent[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { fetchAgents().then(setAgents).catch(() => {}).finally(() => setLoading(false)) }, [])

  return (
    <main style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <h1 style={styles.h1}>{pick(lang, 'الوسطاء والوكالات الموثّقون', 'Verified brokers & agencies', 'Courtiers & agences vérifiés')}</h1>
      <p style={styles.muted}>{pick(lang, 'تعامل مع وسيط أو وكالة موثّقة لمزيد من الأمان والدعم.', 'Work with a verified broker or agency for added trust and support.', 'Travaillez avec un professionnel vérifié.')}</p>
      {loading ? <p style={styles.muted}>…</p> : agents.length === 0 ? (
        <p style={styles.muted}>{pick(lang, 'لا يوجد وسطاء موثّقون بعد.', 'No verified agents yet.', 'Aucun agent vérifié pour le moment.')}</p>
      ) : (
        <div style={styles.grid}>
          {agents.map((a) => (
            <button key={a.id} type="button" style={styles.card} onClick={() => (window.location.hash = `/agent/${a.id}`)}>
              <span style={styles.avatar}>{initials(a.displayName)}</span>
              <span style={styles.cardName}>{a.displayName}</span>
              <span style={styles.badge}>{typeLabel(a.sellerType, lang)} {a.verified ? '· ✓' : ''}</span>
              {a.city ? <span style={styles.muted}>{a.city}</span> : null}
              <span style={styles.count}>{pick(lang, `${a.listingCount} إعلان`, `${a.listingCount} listing${a.listingCount === 1 ? '' : 's'}`, `${a.listingCount} annonce(s)`)}</span>
            </button>
          ))}
        </div>
      )}
    </main>
  )
}

function AgentProfile({ lang, agentId }: { lang: Lang; agentId: string }) {
  const isAr = lang === 'ar'
  const [agent, setAgent] = useState<PlatformAgent | null>(null)
  const [listings, setListings] = useState<PlatformListing[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetchAgent(agentId).then((r) => { setAgent(r.agent); setListings(r.listings) }).catch(() => {}).finally(() => setLoading(false))
  }, [agentId])

  if (loading) return <main style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}><p style={styles.muted}>…</p></main>
  if (!agent) {
    return (
      <main style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
        <p style={styles.muted}>{pick(lang, 'لم يتم العثور على هذا الوسيط.', 'Agent not found.', 'Agent introuvable.')}</p>
        <button type="button" style={styles.backBtn} onClick={() => (window.location.hash = '/agents')}>{pick(lang, 'كل الوسطاء', 'All agents', 'Tous les agents')}</button>
      </main>
    )
  }

  return (
    <main style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <button type="button" style={styles.backBtn} onClick={() => (window.location.hash = '/agents')}>‹ {pick(lang, 'الوسطاء', 'Agents', 'Agents')}</button>
      <header style={styles.profileHead}>
        <span style={styles.avatarLg}>{initials(agent.displayName)}</span>
        <div style={{ display: 'grid', gap: 4 }}>
          <h1 style={styles.h1}>{agent.displayName}</h1>
          <span style={styles.badge}>{typeLabel(agent.sellerType, lang)} · ✓ {pick(lang, 'موثّق', 'Verified', 'Vérifié')}</span>
          {agent.city ? <span style={styles.muted}>{agent.city}</span> : null}
          {agent.languages?.length ? <span style={styles.muted}>{pick(lang, 'اللغات', 'Languages', 'Langues')}: {agent.languages.join(', ')}</span> : null}
        </div>
      </header>
      {agent.about ? <p style={styles.about}>{agent.about}</p> : null}

      <h2 style={styles.h2}>{pick(lang, 'إعلانات الوسيط', 'Listings', 'Annonces')} {listings.length ? `(${listings.length})` : ''}</h2>
      {listings.length === 0 ? (
        <p style={styles.muted}>{pick(lang, 'لا توجد إعلانات نشطة حالياً.', 'No active listings right now.', 'Aucune annonce active.')}</p>
      ) : (
        <div style={styles.grid}>
          {listings.map((l) => {
            const photo = (l.media && l.media[0] && (l.media[0] as { url?: string }).url) || ''
            return (
              <button key={l.id} type="button" style={styles.listingCard} onClick={() => (window.location.hash = `/listing/${l.id}`)}>
                <span style={styles.listingMedia}>{photo ? <img src={photo} alt="" style={styles.img} /> : <span style={styles.noimg}>SYBNB</span>}</span>
                <span style={styles.cardName}>{l.titleEn || l.titleAr || l.id.slice(0, 8)}</span>
                <span style={styles.price}>{moneyText(l.priceMinor, l.currency, lang)}</span>
              </button>
            )
          })}
        </div>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { maxWidth: 1000, margin: '0 auto', padding: '24px 16px 48px', display: 'grid', gap: 10 },
  h1: { fontSize: 24, fontWeight: 800, color: '#0b1b3b', margin: 0 },
  h2: { fontSize: 18, fontWeight: 700, color: '#0b1b3b', margin: '18px 0 10px' },
  muted: { color: '#64748b', fontSize: 14 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 },
  card: { display: 'grid', gap: 6, justifyItems: 'center', textAlign: 'center', border: '1px solid #e4e9f2', borderRadius: 14, padding: 16, background: '#fff', cursor: 'pointer' },
  avatar: { width: 54, height: 54, borderRadius: '50%', background: '#0b1b3b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 20 },
  avatarLg: { width: 72, height: 72, borderRadius: '50%', background: '#0b1b3b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 26, flexShrink: 0 },
  cardName: { fontWeight: 700, color: '#0b1b3b', fontSize: 15 },
  badge: { background: '#eef2ff', color: '#2b5cff', borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 },
  count: { color: '#64748b', fontSize: 13 },
  profileHead: { display: 'flex', alignItems: 'center', gap: 16, marginTop: 6 },
  about: { color: '#334155', fontSize: 15, lineHeight: 1.6, margin: '6px 0 0' },
  backBtn: { background: 'none', border: 'none', color: '#2b5cff', cursor: 'pointer', fontWeight: 600, padding: 0, justifySelf: 'start' as CSSProperties['justifySelf'] },
  listingCard: { display: 'grid', gap: 6, border: '1px solid #e4e9f2', borderRadius: 14, overflow: 'hidden', background: '#fff', cursor: 'pointer', padding: 0, textAlign: 'start' },
  listingMedia: { display: 'block', width: '100%', height: 120, background: '#eef2f8' },
  img: { width: '100%', height: '100%', objectFit: 'cover' },
  noimg: { display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#9aa7bd', fontWeight: 700 },
  price: { fontWeight: 700, color: '#0b1b3b', padding: '0 10px 10px' },
}
