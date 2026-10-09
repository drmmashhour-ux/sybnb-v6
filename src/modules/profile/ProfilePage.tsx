import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { moneyText } from '../../shared/i18n/display'
import {
  fetchMyProfile,
  fetchMyAvatarBlobUrl,
  uploadMyAvatar,
  updateMyDisplayName,
  redeemLoyaltyPoints,
  type MyProfileData,
  type LoyaltySummaryData,
  type LoyaltyTierName,
} from '../../shared/api/platformApi'

type Props = { lang: Lang }

const TIER_META: Record<LoyaltyTierName, { color: string; ar: string; en: string; fr: string; emoji: string }> = {
  BRONZE: { color: '#c08457', ar: 'برونزي', en: 'Bronze', fr: 'Bronze', emoji: '🥉' },
  SILVER: { color: '#9fb2c9', ar: 'فضي', en: 'Silver', fr: 'Argent', emoji: '🥈' },
  GOLD: { color: '#f2c14e', ar: 'ذهبي', en: 'Gold', fr: 'Or', emoji: '🥇' },
  PLATINUM: { color: '#8ea0ff', ar: 'بلاتيني', en: 'Platinum', fr: 'Platine', emoji: '💎' },
}

export function ProfilePage({ lang }: Props) {
  const isAr = lang === 'ar'
  const [profile, setProfile] = useState<MyProfileData | null>(null)
  const [loyalty, setLoyalty] = useState<LoyaltySummaryData | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'signedout'>('loading')
  const [message, setMessage] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [redeemPts, setRedeemPts] = useState(0)
  const [redeeming, setRedeeming] = useState(false)
  const [notice, setNotice] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const t = {
    title: pick(lang, 'ملفي', 'My profile', 'Mon profil'),
    subtitle: pick(lang, 'صورتك، حسابك، ونقاط الولاء.', 'Your photo, your account, and your loyalty points.', 'Votre photo, votre compte et vos points de fidélité.'),
    signin: pick(lang, 'سجّل الدخول لعرض ملفك.', 'Sign in to view your profile.', 'Connectez-vous pour voir votre profil.'),
    addPhoto: pick(lang, 'أضف صورة', 'Add photo', 'Ajouter une photo'),
    changePhoto: pick(lang, 'تغيير الصورة', 'Change photo', 'Changer la photo'),
    name: pick(lang, 'الاسم', 'Name', 'Nom'),
    save: pick(lang, 'حفظ', 'Save', 'Enregistrer'),
    saved: pick(lang, 'تم الحفظ', 'Saved', 'Enregistré'),
    email: pick(lang, 'البريد', 'Email', 'E-mail'),
    memberSince: pick(lang, 'عضو منذ', 'Member since', 'Membre depuis'),
    verifiedHost: pick(lang, 'مضيف موثّق', 'Verified host', 'Hôte vérifié'),
    loyalty: pick(lang, 'برنامج الولاء', 'Loyalty program', 'Programme de fidélité'),
    points: pick(lang, 'نقاطك', 'Your points', 'Vos points'),
    lifetime: pick(lang, 'إجمالي النقاط', 'Lifetime points', 'Points cumulés'),
    tier: pick(lang, 'المستوى', 'Tier', 'Niveau'),
    earnRate: pick(lang, 'معدل الكسب', 'Earn rate', 'Taux de gain'),
    toNext: (n: number, tier: string) => pick(lang, `${n} نقطة للوصول إلى ${tier}`, `${n} points to ${tier}`, `${n} points pour ${tier}`),
    maxTier: pick(lang, 'أعلى مستوى 🎉', 'Top tier reached 🎉', 'Niveau maximum 🎉'),
    redeemTitle: pick(lang, 'استبدال النقاط برصيد', 'Redeem points for wallet credit', 'Échanger des points'),
    redeemHint: (per: number, minor: string, cur: string) =>
      pick(lang, `كل ${per} نقطة = ${minor} ${cur} في محفظتك.`, `Every ${per} points = ${minor} ${cur} in your wallet.`, `${per} points = ${minor} ${cur}.`),
    redeemable: pick(lang, 'المتاح للاستبدال', 'Available to redeem', 'Disponible'),
    redeemBtn: pick(lang, 'استبدال', 'Redeem', 'Échanger'),
    redeemAll: pick(lang, 'استبدال الكل', 'Redeem all', 'Tout échanger'),
    recent: pick(lang, 'آخر الحركات', 'Recent activity', 'Activité récente'),
    aiNote: pick(lang, 'يدير مدير الذكاء الاصطناعي نقاط الولاء ويمنح مكافآت إضافية للأعضاء المميزين.', 'An AI manager runs the loyalty program and grants bonus points to standout members.', 'Un gestionnaire IA pilote le programme de fidélité.'),
    none: pick(lang, 'لا حركات بعد. أكمل حجزاً لتبدأ بكسب النقاط.', 'No activity yet. Complete a booking to start earning.', 'Aucune activité. Terminez une réservation pour gagner des points.'),
  }

  async function load() {
    setStatus('loading')
    try {
      const { profile: p, loyalty: l } = await fetchMyProfile()
      setProfile(p)
      setLoyalty(l)
      setName(p.displayName)
      setRedeemPts(Math.floor(l.pointsBalance / l.config.redeem.stepPoints) * l.config.redeem.stepPoints)
      setStatus('ready')
      if (p.hasAvatar) {
        try {
          setAvatarUrl(await fetchMyAvatarBlobUrl())
        } catch {
          setAvatarUrl('')
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : ''
      if (/not signed in/i.test(msg)) setStatus('signedout')
      else {
        setStatus('error')
        setMessage(msg)
      }
    }
  }
  useEffect(() => {
    void load()
    return () => {
      if (avatarUrl) URL.revokeObjectURL(avatarUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setNotice('')
    try {
      await uploadMyAvatar(file)
      const url = await fetchMyAvatarBlobUrl()
      if (avatarUrl) URL.revokeObjectURL(avatarUrl)
      setAvatarUrl(url)
      setProfile((p) => (p ? { ...p, hasAvatar: true } : p))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function saveName() {
    if (!name.trim()) return
    setSavingName(true)
    setNotice('')
    try {
      await updateMyDisplayName(name.trim())
      setProfile((p) => (p ? { ...p, displayName: name.trim() } : p))
      setNotice(t.saved)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '')
    } finally {
      setSavingName(false)
    }
  }

  async function doRedeem() {
    if (!loyalty || redeemPts < loyalty.config.redeem.minPoints) return
    setRedeeming(true)
    setNotice('')
    try {
      const r = await redeemLoyaltyPoints(redeemPts)
      setLoyalty(r.loyalty)
      setRedeemPts(Math.floor(r.loyalty.pointsBalance / r.loyalty.config.redeem.stepPoints) * r.loyalty.config.redeem.stepPoints)
      setNotice(
        pick(
          lang,
          `تم إضافة ${moneyText(r.redeemed.creditMinor, r.redeemed.currency, lang)} إلى محفظتك.`,
          `${moneyText(r.redeemed.creditMinor, r.redeemed.currency, lang)} added to your wallet.`,
          `${moneyText(r.redeemed.creditMinor, r.redeemed.currency, lang)} ajoutés à votre portefeuille.`,
        ),
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '')
    } finally {
      setRedeeming(false)
    }
  }

  const fmtDate = (v: string) => {
    try {
      return new Date(v).toLocaleDateString(isAr ? 'ar' : lang === 'fr' ? 'fr' : 'en', { year: 'numeric', month: 'long', day: 'numeric' })
    } catch {
      return v.slice(0, 10)
    }
  }

  if (status === 'signedout') {
    return (
      <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
        <div style={styles.card}><p style={styles.body}>{t.signin}</p>
          <button style={styles.primary} onClick={() => (window.location.hash = '/account')}>{pick(lang, 'تسجيل الدخول', 'Sign in', 'Se connecter')}</button>
        </div>
      </main>
    )
  }

  const tier = loyalty?.tier || 'BRONZE'
  const tm = TIER_META[tier]
  const initials = (profile?.displayName || '?').trim().slice(0, 1).toUpperCase()
  const red = loyalty?.config.redeem

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = profile?.isVerifiedHost ? '/host' : '/dashboard')}>
        {pick(lang, '← رجوع', '← Back', '← Retour')}
      </button>
      <header style={styles.hero}>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
      </header>

      {status === 'loading' && <p style={styles.body}>{pick(lang, 'جار التحميل…', 'Loading…', 'Chargement…')}</p>}
      {status === 'error' && <p style={styles.alert}>{message}</p>}

      {status === 'ready' && profile && loyalty && (
        <>
          <section style={styles.card}>
            <div style={styles.identity}>
              <button style={styles.avatarWrap} onClick={() => fileRef.current?.click()} title={profile.hasAvatar ? t.changePhoto : t.addPhoto}>
                {avatarUrl ? <img src={avatarUrl} alt="" style={styles.avatarImg} /> : <span style={{ ...styles.avatarInitials, background: tm.color }}>{initials}</span>}
                <span style={styles.avatarEdit}>✎</span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFile} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.nameRow}>
                  <input style={styles.nameInput} value={name} onChange={(e) => setName(e.target.value)} />
                  <button style={styles.secondary} disabled={savingName || !name.trim() || name.trim() === profile.displayName} onClick={() => void saveName()}>{savingName ? '…' : t.save}</button>
                </div>
                <div style={styles.metaRow}>
                  {profile.email && <span>{t.email}: <b style={{ color: '#cdd6ff' }}>{profile.email}</b></span>}
                  <span>{t.memberSince} {fmtDate(profile.memberSince)}</span>
                  {profile.isVerifiedHost && <span style={styles.verified}>✓ {t.verifiedHost}</span>}
                </div>
              </div>
            </div>
            {notice && <p style={styles.notice}>{notice}</p>}
          </section>

          <section style={{ ...styles.card, borderColor: tm.color + '55' }}>
            <div style={styles.loyHead}>
              <h2 style={styles.h2}>{t.loyalty}</h2>
              <span style={{ ...styles.tierBadge, background: tm.color + '22', color: tm.color, borderColor: tm.color + '66' }}>
                {tm.emoji} {pick(lang, tm.ar, tm.en, tm.fr)}
              </span>
            </div>
            <div style={styles.statRow}>
              <div style={styles.stat}><span>{t.points}</span><b style={{ color: tm.color, fontSize: 24 }}>{loyalty.pointsBalance.toLocaleString()}</b></div>
              <div style={styles.stat}><span>{t.lifetime}</span><b>{loyalty.lifetimePoints.toLocaleString()}</b></div>
              <div style={styles.stat}><span>{t.earnRate}</span><b>×{loyalty.multiplier}</b></div>
            </div>
            {loyalty.nextTier ? (
              <div style={styles.progressWrap}>
                <div style={styles.progressBar}><i style={{ width: `${progressPct(loyalty)}%`, background: tm.color }} /></div>
                <span style={styles.progressLabel}>{t.toNext(loyalty.nextTier.pointsToGo, tierLabel(loyalty.nextTier.tier, lang))}</span>
              </div>
            ) : (
              <p style={styles.progressLabel}>{t.maxTier}</p>
            )}

            {red && (
              <div style={styles.redeemBox}>
                <h3 style={styles.h3}>{t.redeemTitle}</h3>
                <p style={styles.hint}>{t.redeemHint(red.pointsPerUnit, red.minorPerUnit.toLocaleString(), red.currency)}</p>
                <div style={styles.redeemRow}>
                  <input
                    type="range"
                    min={0}
                    max={Math.floor(loyalty.pointsBalance / red.stepPoints) * red.stepPoints}
                    step={red.stepPoints}
                    value={redeemPts}
                    onChange={(e) => setRedeemPts(Number(e.target.value))}
                    style={{ flex: 1 }}
                    disabled={loyalty.pointsBalance < red.minPoints}
                  />
                  <button style={styles.linkBtn} onClick={() => setRedeemPts(Math.floor(loyalty.pointsBalance / red.stepPoints) * red.stepPoints)}>{t.redeemAll}</button>
                </div>
                <div style={styles.redeemFoot}>
                  <span>{redeemPts.toLocaleString()} {pick(lang, 'نقطة', 'pts', 'pts')} → <b style={{ color: '#49d08b' }}>{moneyText((redeemPts / red.pointsPerUnit) * red.minorPerUnit, red.currency, lang)}</b></span>
                  <button style={styles.primary} disabled={redeeming || redeemPts < red.minPoints} onClick={() => void doRedeem()}>{redeeming ? '…' : t.redeemBtn}</button>
                </div>
                {loyalty.pointsBalance < red.minPoints && <p style={styles.hint}>{pick(lang, `تحتاج ${red.minPoints} نقطة على الأقل للاستبدال.`, `You need at least ${red.minPoints} points to redeem.`, `Minimum ${red.minPoints} points.`)}</p>}
              </div>
            )}

            <p style={styles.aiNote}>🤖 {t.aiNote}</p>

            <h3 style={styles.h3}>{t.recent}</h3>
            {loyalty.recent.length === 0 ? (
              <p style={styles.hint}>{t.none}</p>
            ) : (
              <ul style={styles.activity}>
                {loyalty.recent.map((e) => (
                  <li key={e.id} style={styles.actItem}>
                    <span style={{ color: e.points >= 0 ? '#49d08b' : '#ff8f8f', fontWeight: 800 }}>{e.points >= 0 ? '+' : ''}{e.points}</span>
                    <span style={styles.actReason}>{e.reason || e.type}</span>
                    <span style={styles.actDate}>{fmtDate(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}

function progressPct(l: LoyaltySummaryData): number {
  if (!l.nextTier) return 100
  const tiers = l.config.tiers
  const current = tiers.filter((x) => l.lifetimePoints >= x.min).slice(-1)[0]
  const curMin = current?.min ?? 0
  const nextMin = l.nextTier ? tiers.find((x) => x.tier === l.nextTier!.tier)?.min ?? curMin + 1 : curMin + 1
  const span = Math.max(1, nextMin - curMin)
  return Math.max(0, Math.min(100, Math.round(((l.lifetimePoints - curMin) / span) * 100)))
}
function tierLabel(tier: LoyaltyTierName, lang: Lang) {
  const m = TIER_META[tier]
  return pick(lang, m.ar, m.en, m.fr)
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 760, margin: '0 auto', padding: '24px 16px 80px', color: '#e9edf8', fontFamily: 'inherit' },
  back: { background: 'transparent', border: 0, color: '#7d90ff', fontWeight: 800, fontSize: 14, cursor: 'pointer', padding: '4px 0', marginBottom: 8 },
  hero: { marginBottom: 16 },
  title: { fontSize: 26, fontWeight: 900, color: '#fff', margin: '0 0 6px' },
  body: { color: '#9aa7bd', fontSize: 14.5, lineHeight: 1.6, margin: 0 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 10, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 12 },
  card: { background: 'linear-gradient(180deg,#111b2e,#0c1322)', border: '1px solid rgba(130,150,200,.16)', borderRadius: 16, padding: 18, marginBottom: 16 },
  identity: { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' },
  avatarWrap: { position: 'relative', width: 84, height: 84, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer', background: 'transparent', flex: '0 0 auto' },
  avatarImg: { width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(130,150,200,.3)' },
  avatarInitials: { width: 84, height: 84, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, fontWeight: 900, color: '#06110e' },
  avatarEdit: { position: 'absolute', bottom: 0, insetInlineEnd: 0, width: 26, height: 26, borderRadius: '50%', background: '#5b74ff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, border: '2px solid #0c1322' },
  nameRow: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
  nameInput: { flex: 1, minWidth: 0, minHeight: 42, border: '1px solid #30384d', borderRadius: 10, background: '#0c1220', color: '#fff', padding: '0 12px', fontSize: 16, fontWeight: 700, fontFamily: 'inherit' },
  metaRow: { display: 'flex', gap: 14, flexWrap: 'wrap', color: '#8ea0b8', fontSize: 12.5, fontWeight: 600 },
  verified: { color: '#49d08b', fontWeight: 800 },
  notice: { margin: '12px 0 0', color: '#b7ffe8', fontSize: 13, fontWeight: 700 },
  loyHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 },
  h2: { fontSize: 18, fontWeight: 900, color: '#fff', margin: 0 },
  h3: { fontSize: 14, fontWeight: 800, color: '#cdd6ff', margin: '18px 0 8px' },
  tierBadge: { fontSize: 13, fontWeight: 900, padding: '6px 12px', borderRadius: 999, border: '1px solid' },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 },
  stat: { border: '1px solid rgba(130,150,200,.14)', borderRadius: 12, background: 'rgba(7,11,22,.5)', padding: 12, display: 'grid', gap: 4, color: '#9aa7bd', fontSize: 12.5, fontWeight: 700 },
  progressWrap: { display: 'grid', gap: 6 },
  progressBar: { height: 9, borderRadius: 999, background: 'rgba(130,150,200,.14)', overflow: 'hidden' },
  progressLabel: { color: '#9aa7bd', fontSize: 12.5, fontWeight: 700, margin: 0 },
  redeemBox: { marginTop: 18, borderTop: '1px solid rgba(130,150,200,.14)', paddingTop: 16 },
  hint: { color: '#6c7b96', fontSize: 12.5, lineHeight: 1.5, margin: '4px 0' },
  redeemRow: { display: 'flex', gap: 12, alignItems: 'center', margin: '10px 0' },
  redeemFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 14, color: '#c3ccdd' },
  linkBtn: { background: 'transparent', border: 0, color: '#7d90ff', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' },
  aiNote: { marginTop: 16, padding: 12, borderRadius: 10, background: 'rgba(91,116,255,.08)', border: '1px solid rgba(91,116,255,.22)', color: '#aeb9e8', fontSize: 12.5, lineHeight: 1.6 },
  activity: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 },
  actItem: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center', border: '1px solid rgba(130,150,200,.12)', borderRadius: 10, background: 'rgba(7,11,22,.4)', padding: '9px 12px', fontSize: 13 },
  actReason: { color: '#c3ccdd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  actDate: { color: '#6c7b96', fontSize: 11.5, whiteSpace: 'nowrap' },
  primary: { minHeight: 44, border: 0, borderRadius: 10, background: '#20d29b', color: '#06110e', fontWeight: 900, padding: '0 18px', cursor: 'pointer' },
  secondary: { minHeight: 42, border: '1px solid #30384d', borderRadius: 10, background: '#171b29', color: '#fff', fontWeight: 800, padding: '0 14px', cursor: 'pointer', whiteSpace: 'nowrap' },
}

export default ProfilePage
