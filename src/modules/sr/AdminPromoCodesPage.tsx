import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { createPromoCode, fetchPromoCodes, setPromoCodeActive, type PlatformPromoCode } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'أكواد الخصم — سير',
    subtitle: 'إدارة أكواد الخصم لرحلات سير. كل كود قابل للاستخدام مرة واحدة لكل راكب.',
    code: 'الكود',
    type: 'النوع',
    percent: 'نسبة مئوية',
    flat: 'مبلغ ثابت',
    value: 'القيمة',
    maxDiscount: 'الحد الأقصى للخصم (اختياري، للنسبة المئوية)',
    expiresAt: 'تاريخ الانتهاء (اختياري)',
    create: 'إنشاء كود',
    creating: 'جار الإنشاء...',
    active: 'فعال',
    inactive: 'موقوف',
    deactivate: 'إيقاف',
    activate: 'تفعيل',
    empty: 'لا توجد أكواد خصم بعد.',
    loading: 'جار التحميل...',
    error: 'تعذر تحميل أكواد الخصم',
  },
  en: {
    back: 'Back to landing',
    title: 'Promo Codes — SR Ride',
    subtitle: 'Manage discount codes for SR rides. Each code redeems once per rider.',
    code: 'Code',
    type: 'Type',
    percent: 'Percent',
    flat: 'Flat amount',
    value: 'Value',
    maxDiscount: 'Max discount (optional, percent only)',
    expiresAt: 'Expires at (optional)',
    create: 'Create code',
    creating: 'Creating...',
    active: 'Active',
    inactive: 'Inactive',
    deactivate: 'Deactivate',
    activate: 'Activate',
    empty: 'No promo codes yet.',
    loading: 'Loading...',
    error: 'Could not load promo codes',
  },
}

export function AdminPromoCodesPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = copy[isAr ? 'ar' : 'en']
  const [promoCodes, setPromoCodes] = useState<PlatformPromoCode[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')

  const [code, setCode] = useState('')
  const [discountType, setDiscountType] = useState<'PERCENT' | 'FLAT'>('PERCENT')
  const [discountValue, setDiscountValue] = useState('')
  const [maxDiscountMinor, setMaxDiscountMinor] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStatus('loading')
    try {
      setPromoCodes(await fetchPromoCodes())
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function submitCreate() {
    if (!code.trim() || !discountValue) return
    setCreating(true)
    setMessage('')
    try {
      await createPromoCode({
        code: code.trim(),
        discountType,
        discountValue: Number(discountValue),
        maxDiscountMinor: maxDiscountMinor ? Number(maxDiscountMinor) : undefined,
        expiresAt: expiresAt || undefined,
      })
      setCode('')
      setDiscountValue('')
      setMaxDiscountMinor('')
      setExpiresAt('')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(promoCode: PlatformPromoCode) {
    try {
      await setPromoCodeActive(promoCode.id, !promoCode.active)
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

      <article style={styles.card}>
        <div style={styles.formRow}>
          <input style={styles.input} value={code} onChange={(event) => setCode(event.target.value)} placeholder={t.code} />
          <select style={styles.input} value={discountType} onChange={(event) => setDiscountType(event.target.value as 'PERCENT' | 'FLAT')}>
            <option value="PERCENT">{t.percent}</option>
            <option value="FLAT">{t.flat}</option>
          </select>
          <input
            style={styles.input}
            type="number"
            value={discountValue}
            onChange={(event) => setDiscountValue(event.target.value)}
            placeholder={t.value}
          />
        </div>
        <div style={styles.formRow}>
          <input
            style={styles.input}
            type="number"
            value={maxDiscountMinor}
            onChange={(event) => setMaxDiscountMinor(event.target.value)}
            placeholder={t.maxDiscount}
            disabled={discountType !== 'PERCENT'}
          />
          <input
            style={styles.input}
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
          <button disabled={!code.trim() || !discountValue || creating} style={styles.primaryButton} onClick={() => void submitCreate()}>
            {creating ? t.creating : t.create}
          </button>
        </div>
        {message && <p style={styles.error}>{message}</p>}
      </article>

      {status === 'loading' && <p>{t.loading}</p>}
      {status === 'error' && <p style={styles.error}>{message}</p>}
      {status === 'ready' && promoCodes.length === 0 && <p>{t.empty}</p>}

      <div style={styles.grid}>
        {promoCodes.map((promoCode) => (
          <article key={promoCode.id} style={styles.card}>
            <strong dir="ltr">{promoCode.code}</strong>
            <span>
              {promoCode.discountType === 'PERCENT' ? `${promoCode.discountValue}%` : moneyText(promoCode.discountValue, 'SYP', lang)}
              {promoCode.discountType === 'PERCENT' && promoCode.maxDiscountMinor != null
                ? ` (max ${moneyText(promoCode.maxDiscountMinor, 'SYP', lang)})`
                : ''}
            </span>
            {promoCode.expiresAt && <span dir="ltr">{new Date(promoCode.expiresAt).toLocaleString(isAr ? 'ar-SY' : 'en-US')}</span>}
            <span style={promoCode.active ? styles.activeBadge : styles.inactiveBadge}>
              {promoCode.active ? t.active : t.inactive}
            </span>
            <button style={styles.secondaryButton} onClick={() => void toggleActive(promoCode)}>
              {promoCode.active ? t.deactivate : t.activate}
            </button>
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
  secondaryButton: { minHeight: 40, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' },
  activeBadge: { display: 'inline-block', width: 'fit-content', borderRadius: 999, background: 'rgba(32,210,155,.14)', border: '1px solid rgba(32,210,155,.4)', color: '#20d29b', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  inactiveBadge: { display: 'inline-block', width: 'fit-content', borderRadius: 999, background: 'rgba(255,96,96,.14)', border: '1px solid rgba(255,96,96,.4)', color: '#ff8aa0', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  error: { color: '#ff8aa0', margin: 0 },
}
