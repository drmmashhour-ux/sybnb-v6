import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  addBusinessMember,
  fetchBusinessUsage,
  fetchMyBusinessAccount,
  removeBusinessMember,
  type PlatformBusinessAccount,
  type PlatformBusinessAccountMember,
  type PlatformRideRequest,
} from '../../shared/api/platformApi'
import { moneyText, statusText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'إدارة الحساب التجاري',
    subtitle: 'أضف الموظفين، وتابع استخدامهم لرحلات سير المحتسبة على حساب الشركة.',
    notAdmin: 'هذا الحساب لا يدير حساباً تجارياً.',
    members: 'الأعضاء',
    addMemberPlaceholder: 'البريد الإلكتروني للموظف',
    addMember: 'إضافة عضو',
    adding: 'جار الإضافة...',
    remove: 'إزالة',
    noMembers: 'لا يوجد أعضاء بعد.',
    usage: 'استخدام الرحلات',
    totalCompleted: 'إجمالي الرحلات المكتملة',
    noRides: 'لا توجد رحلات محتسبة على الشركة بعد.',
    rider: 'الراكب',
    status: 'الحالة',
    fare: 'الأجرة',
    loading: 'جار التحميل...',
    error: 'حدث خطأ',
  },
  en: {
    back: 'Back to landing',
    title: 'Manage Business Account',
    subtitle: 'Add employees and track their SR ride usage billed to your company.',
    notAdmin: 'This account does not manage a business account.',
    members: 'Members',
    addMemberPlaceholder: "Employee's email",
    addMember: 'Add member',
    adding: 'Adding...',
    remove: 'Remove',
    noMembers: 'No members yet.',
    usage: 'Ride Usage',
    totalCompleted: 'Total completed rides',
    noRides: 'No rides billed to your company yet.',
    rider: 'Rider',
    status: 'Status',
    fare: 'Fare',
    loading: 'Loading...',
    error: 'Something went wrong',
  },
}

export function BusinessAccountPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = copy[isAr ? 'ar' : 'en']
  const [account, setAccount] = useState<PlatformBusinessAccount | null>(null)
  const [members, setMembers] = useState<PlatformBusinessAccountMember[]>([])
  const [rides, setRides] = useState<PlatformRideRequest[]>([])
  const [totalMinor, setTotalMinor] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-admin' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStatus('loading')
    try {
      const [accountResult, usageResult] = await Promise.all([fetchMyBusinessAccount(), fetchBusinessUsage()])
      setAccount(accountResult.account)
      setMembers(accountResult.members)
      setRides(usageResult.rides)
      setTotalMinor(usageResult.totalMinor)
      setStatus('ready')
    } catch (error) {
      const code = (error as { code?: string })?.code
      if (code === 'BUSINESS_ACCOUNT_NOT_ADMIN') {
        setStatus('not-admin')
      } else {
        setStatus('error')
        setMessage(error instanceof Error ? error.message : t.error)
      }
    }
  }

  async function submitAddMember() {
    if (!newMemberEmail.trim()) return
    setAdding(true)
    setMessage('')
    try {
      await addBusinessMember(newMemberEmail.trim())
      setNewMemberEmail('')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setAdding(false)
    }
  }

  async function removeMember(userId: string) {
    try {
      await removeBusinessMember(userId)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      {status === 'loading' && <p>{t.loading}</p>}
      {status === 'not-admin' && <p style={styles.error}>{t.notAdmin}</p>}
      {status === 'error' && <p style={styles.error}>{message}</p>}

      {status === 'ready' && account && (
        <>
          <article style={styles.card}>
            <strong>{account.name}</strong>
            <span dir="ltr">{account.billingContactEmail}</span>
          </article>

          <article style={styles.card}>
            <strong>{t.members}</strong>
            <div style={styles.formRow}>
              <input
                style={styles.input}
                value={newMemberEmail}
                onChange={(event) => setNewMemberEmail(event.target.value)}
                placeholder={t.addMemberPlaceholder}
              />
              <button disabled={!newMemberEmail.trim() || adding} style={styles.primaryButton} onClick={() => void submitAddMember()}>
                {adding ? t.adding : t.addMember}
              </button>
            </div>
            {message && <p style={styles.error}>{message}</p>}
            {members.length === 0 ? (
              <p>{t.noMembers}</p>
            ) : (
              members.map((member) => (
                <div key={member.id} style={styles.memberRow}>
                  <span>
                    {member.user.displayName} ({member.user.email})
                  </span>
                  <button style={styles.secondaryButton} onClick={() => void removeMember(member.userId)}>
                    {t.remove}
                  </button>
                </div>
              ))
            )}
          </article>

          <article style={styles.card}>
            <strong>{t.usage}</strong>
            <div style={styles.stat}>
              <span>{t.totalCompleted}</span>
              <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(totalMinor, 'SYP', lang)}</strong>
            </div>
            {rides.length === 0 ? (
              <p>{t.noRides}</p>
            ) : (
              rides.map((ride) => (
                <div key={ride.id} style={styles.memberRow}>
                  <span>{ride.rider?.displayName}</span>
                  <span dir={isAr ? 'rtl' : 'ltr'}>{statusText(ride.status, lang)}</span>
                  <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(ride.fareMinor || 0, ride.currency, lang)}</strong>
                </div>
              ))
            )}
          </article>
        </>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 700, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  title: { margin: 0, fontSize: 28 },
  subtitle: { color: '#9aa6ba', margin: 0 },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 10 },
  formRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 },
  input: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
  primaryButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 36, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 12px' },
  memberRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTop: '1px solid #263651', paddingTop: 8 },
  stat: { borderTop: '1px solid #263651', display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba', paddingTop: 9 },
  error: { color: '#ff8aa0', margin: 0 },
}
