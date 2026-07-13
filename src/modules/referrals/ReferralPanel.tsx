import { useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { SUPPORT_WHATSAPP_LOCAL } from '../../shared/support/contactChannels'

type Props = {
  lang: Lang
  referralCode?: string
  rewardedCount: number
  pendingCount: number
}

// $5 / $10 mirror REFEREE_SIGNUP_BONUS_MINOR / REFERRER_REWARD_MINOR in server/lib/referrals.mjs
// -- if those constants change, update this copy to match (not fetched dynamically, since these
// are rarely-changed business constants, same as this codebase's other hardcoded-but-disclosed
// rates like the 10% STR commission).
const copy = {
  ar: {
    title: 'ادعُ أصدقاءك واربح',
    body: 'شارك رمزك مع أصدقائك. عند تسجيلهم يحصلون على رصيد ترحيبي 5$ في محفظتهم، وتحصل أنت على 10$ عند إتمامهم أول حجز مدفوع.',
    yourCode: 'رمزك',
    copy: 'نسخ',
    copied: 'تم النسخ',
    share: 'مشاركة عبر واتساب',
    rewarded: 'إحالات مكافأة',
    pending: 'بانتظار أول حجز',
    shareText: (code: string) => `انضم إلى SYBNB واحصل على رصيد ترحيبي 5$! استخدم رمز الإحالة: ${code}`,
  },
  en: {
    title: 'Invite friends, earn rewards',
    body: 'Share your code with friends. When they sign up, they get a $5 welcome credit in their wallet — you get $10 once they complete their first paid booking.',
    yourCode: 'Your code',
    copy: 'Copy',
    copied: 'Copied',
    share: 'Share via WhatsApp',
    rewarded: 'Rewarded referrals',
    pending: 'Waiting on first booking',
    shareText: (code: string) => `Join SYBNB and get a $5 welcome credit! Use referral code: ${code}`,
  },
}

export function ReferralPanel({ lang, referralCode, rewardedCount, pendingCount }: Props) {
  const t = copy[lang]
  const [copied, setCopied] = useState(false)

  if (!referralCode) return null

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(referralCode as string)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can fail (permissions, insecure context) -- the code is still visible
      // and selectable on screen, so this is a soft failure, not something to surface as an error.
    }
  }

  function shareOnWhatsApp() {
    const text = encodeURIComponent(t.shareText(referralCode as string))
    window.open(`https://wa.me/${SUPPORT_WHATSAPP_LOCAL.replace(/[^\d]/g, '')}?text=${text}`, '_blank', 'noopener')
  }

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <h2 style={styles.title}>{t.title}</h2>
        <p style={styles.body}>{t.body}</p>
      </div>

      <div style={styles.codeRow}>
        <div style={styles.codeBox}>
          <span style={styles.codeLabel}>{t.yourCode}</span>
          <strong style={styles.codeValue}>{referralCode}</strong>
        </div>
        <button style={styles.secondaryButton} onClick={() => void copyCode()}>
          {copied ? t.copied : t.copy}
        </button>
        <button style={styles.primaryButton} onClick={shareOnWhatsApp}>
          {t.share}
        </button>
      </div>

      <div style={styles.stats}>
        <article style={styles.stat}>
          <strong>{rewardedCount}</strong>
          <span>{t.rewarded}</span>
        </article>
        <article style={styles.stat}>
          <strong>{pendingCount}</strong>
          <span>{t.pending}</span>
        </article>
      </div>
    </section>
  )
}

const styles = {
  panel: {
    background: '#101526',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: '20px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  header: { display: 'flex', flexDirection: 'column', gap: 4 },
  title: { color: '#fff', fontSize: 17, fontWeight: 900, margin: 0 },
  body: { color: 'rgba(255,255,255,0.7)', fontSize: 13.5, lineHeight: 1.6, margin: 0 },
  codeRow: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  codeBox: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px dashed rgba(255,255,255,0.25)',
    borderRadius: 10,
    padding: '8px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  codeLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
  codeValue: { color: '#f4d676', fontSize: 18, letterSpacing: 2, fontFamily: 'monospace' },
  secondaryButton: {
    minHeight: 40,
    border: '1px solid #30384d',
    borderRadius: 8,
    background: '#171b29',
    color: '#fff',
    fontWeight: 900,
    padding: '0 14px',
  },
  primaryButton: {
    minHeight: 40,
    border: 0,
    borderRadius: 8,
    background: '#20d29b',
    color: '#06110e',
    fontWeight: 950,
    padding: '0 14px',
  },
  stats: { display: 'flex', gap: 12 },
  stat: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    color: '#fff',
  },
} as const
