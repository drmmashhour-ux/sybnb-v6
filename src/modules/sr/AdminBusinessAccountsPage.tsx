import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { createBusinessAccount, fetchBusinessAccounts, type PlatformBusinessAccount } from '../../shared/api/platformApi'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'الحسابات التجارية — سير',
    subtitle: 'إنشاء حسابات الشركات. يقوم مسؤول الشركة لاحقاً بإدارة أعضائه الخاصين.',
    name: 'اسم الشركة',
    billingEmail: 'بريد التحصيل الإلكتروني',
    adminEmail: 'بريد مسؤول الشركة (يجب أن يملك حساباً بالفعل)',
    create: 'إنشاء حساب تجاري',
    creating: 'جار الإنشاء...',
    empty: 'لا توجد حسابات تجارية بعد.',
    loading: 'جار التحميل...',
    error: 'تعذر تحميل الحسابات التجارية',
    active: 'فعال',
    admin: 'المسؤول',
  },
  en: {
    back: 'Back to landing',
    title: 'Business Accounts — SR Ride',
    subtitle: "Onboard a company. The company's own admin later manages their own members.",
    name: 'Company name',
    billingEmail: 'Billing contact email',
    adminEmail: "Company admin's email (must already have an account)",
    create: 'Create business account',
    creating: 'Creating...',
    empty: 'No business accounts yet.',
    loading: 'Loading...',
    error: 'Could not load business accounts',
    active: 'Active',
    admin: 'Admin',
  },
  fr: {
    back: 'Retour à l’accueil',
    title: 'Comptes entreprises — SR Ride',
    subtitle: 'Inscrivez une entreprise. L’administrateur de l’entreprise gère ensuite ses propres membres.',
    name: 'Nom de l’entreprise',
    billingEmail: 'Courriel de facturation',
    adminEmail: 'Courriel de l’administrateur de l’entreprise (doit déjà avoir un compte)',
    create: 'Créer un compte entreprise',
    creating: 'Création...',
    empty: 'Aucun compte entreprise pour l’instant.',
    loading: 'Chargement...',
    error: 'Impossible de charger les comptes entreprises',
    active: 'Actif',
    admin: 'Administrateur',
  },
}

export function AdminBusinessAccountsPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = copy[lang]
  const [accounts, setAccounts] = useState<PlatformBusinessAccount[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')

  const [name, setName] = useState('')
  const [billingContactEmail, setBillingContactEmail] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStatus('loading')
    try {
      setAccounts(await fetchBusinessAccounts())
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function submitCreate() {
    if (!name.trim() || !billingContactEmail.trim() || !adminEmail.trim()) return
    setCreating(true)
    setMessage('')
    try {
      await createBusinessAccount({ name: name.trim(), billingContactEmail: billingContactEmail.trim(), adminEmail: adminEmail.trim() })
      setName('')
      setBillingContactEmail('')
      setAdminEmail('')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setCreating(false)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      <article style={styles.card}>
        <div style={styles.formRow}>
          <input style={styles.input} value={name} onChange={(event) => setName(event.target.value)} placeholder={t.name} />
          <input
            style={styles.input}
            value={billingContactEmail}
            onChange={(event) => setBillingContactEmail(event.target.value)}
            placeholder={t.billingEmail}
          />
          <input style={styles.input} value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder={t.adminEmail} />
        </div>
        <button
          disabled={!name.trim() || !billingContactEmail.trim() || !adminEmail.trim() || creating}
          style={styles.primaryButton}
          onClick={() => void submitCreate()}
        >
          {creating ? t.creating : t.create}
        </button>
        {message && <p style={styles.error}>{message}</p>}
      </article>

      {status === 'loading' && <p>{t.loading}</p>}
      {status === 'error' && <p style={styles.error}>{message}</p>}
      {status === 'ready' && accounts.length === 0 && <p>{t.empty}</p>}

      <div style={styles.grid}>
        {accounts.map((account) => (
          <article key={account.id} style={styles.card}>
            <strong>{account.name}</strong>
            <span dir="ltr">{account.billingContactEmail}</span>
            <span>
              {t.admin}: {account.admin?.displayName} ({account.admin?.email})
            </span>
            <span style={account.active ? styles.activeBadge : styles.inactiveBadge}>{account.active ? t.active : '-'}</span>
          </article>
        ))}
      </div>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 900, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  title: { margin: 0, fontSize: 28 },
  subtitle: { color: '#9aa6ba', margin: 0 },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 10 },
  formRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 },
  input: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
  primaryButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' },
  activeBadge: { display: 'inline-block', width: 'fit-content', borderRadius: 999, background: 'rgba(32,210,155,.14)', border: '1px solid rgba(32,210,155,.4)', color: '#20d29b', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  inactiveBadge: { display: 'inline-block', width: 'fit-content', borderRadius: 999, background: 'rgba(255,96,96,.14)', border: '1px solid rgba(255,96,96,.4)', color: '#ff8aa0', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  error: { color: '#ff8aa0', margin: 0 },
}
