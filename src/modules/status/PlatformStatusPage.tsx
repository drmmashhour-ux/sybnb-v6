import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  fetchPrototypeAdminMetrics,
  fetchPrototypeContracts,
  fetchPrototypeHealth,
  type PlatformAdminMetrics,
  type PlatformContracts,
  type PlatformHealth,
} from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'حالة المنصة',
    subtitle: 'فحص سريع للخدمة، قاعدة البيانات، العقود، ومؤشرات التشغيل.',
    refresh: 'تحديث',
    loading: 'جار التحميل',
    error: 'تعذر تحميل حالة المنصة',
    service: 'الخدمة',
    database: 'قاعدة البيانات',
    endpoints: 'واجهات API',
    security: 'قواعد الأمان',
    users: 'المستخدمون',
    listings: 'الإعلانات',
    bookings: 'الحجوزات',
    rides: 'رحلات SR',
    payments: 'المدفوعات',
    wallet: 'المحفظة',
    ok: 'متصل',
    issue: 'تحتاج مراجعة',
    readiness: 'جاهزية الإطلاق',
    demoReady: 'جاهز للمراجعة النهائية',
    productionBlocked: 'إنتاج حقيقي مؤجل',
    deployChecklist: 'قائمة تجهيز النشر',
    productionBlockers: 'عوائق الإنتاج',
    securityControls: 'ضوابط الأمان',
    routeAudit: 'تدقيق المسارات',
    finalBuild: 'البناء النهائي',
    staging: 'Staging أولاً',
    legalFinance: 'مراجعة قانونية ومالية',
    blockerRows: ['المصادقة والصلاحيات النهائية', 'رفع الملفات الحقيقي', 'دفتر محفظة فعلي للحجز والاسترداد والصرف', 'قواعد الاسترداد والإلغاء', 'مراقبة وأمان API'],
    checklistRows: ['تأكيد متغيرات البيئة', 'تشغيل migrations', 'فحص الصور و QR', 'مراجعة النص العربي والإنجليزي', 'اختبار جميع المسارات', 'النشر إلى staging قبل production'],
  },
  en: {
    back: 'Back to landing',
    title: 'Platform Status',
    subtitle: 'Quick check for service, database, contracts, and operating metrics.',
    refresh: 'Refresh',
    loading: 'Loading',
    error: 'Could not load platform status',
    service: 'Service',
    database: 'Database',
    endpoints: 'API endpoints',
    security: 'Security rules',
    users: 'Users',
    listings: 'Listings',
    bookings: 'Bookings',
    rides: 'SR rides',
    payments: 'Payments',
    wallet: 'Wallet',
    ok: 'Connected',
    issue: 'Needs review',
    readiness: 'Launch readiness',
    demoReady: 'Final review ready',
    productionBlocked: 'Production delayed',
    deployChecklist: 'Deployment checklist',
    productionBlockers: 'Production blockers',
    securityControls: 'Security controls',
    routeAudit: 'Route audit',
    finalBuild: 'Final build',
    staging: 'Staging first',
    legalFinance: 'Legal and finance review',
    blockerRows: ['Final auth and permissions', 'Real file uploads', 'Real wallet ledger for holds/refunds/payouts', 'Refund and cancellation rules', 'API monitoring and security'],
    checklistRows: ['Confirm environment variables', 'Run migrations', 'Check images and QR', 'Review Arabic and English copy', 'Smoke test all routes', 'Deploy to staging before production'],
  },
  fr: {
    back: 'Retour à l’accueil',
    title: 'État de la plateforme',
    subtitle: 'Vérification rapide du service, de la base de données, des contrats et des indicateurs d’exploitation.',
    refresh: 'Actualiser',
    loading: 'Chargement',
    error: 'Impossible de charger l’état de la plateforme',
    service: 'Service',
    database: 'Base de données',
    endpoints: 'Points de terminaison API',
    security: 'Règles de sécurité',
    users: 'Utilisateurs',
    listings: 'Annonces',
    bookings: 'Réservations',
    rides: 'Courses SR',
    payments: 'Paiements',
    wallet: 'Portefeuille',
    ok: 'Connecté',
    issue: 'À vérifier',
    readiness: 'Préparation au lancement',
    demoReady: 'Prêt pour la revue finale',
    productionBlocked: 'Production reportée',
    deployChecklist: 'Liste de vérification du déploiement',
    productionBlockers: 'Obstacles à la production',
    securityControls: 'Contrôles de sécurité',
    routeAudit: 'Audit des routes',
    finalBuild: 'Build final',
    staging: 'Staging d’abord',
    legalFinance: 'Revue juridique et financière',
    blockerRows: ['Authentification et autorisations finales', 'Téléversement réel des fichiers', 'Registre de portefeuille réel pour les retenues, remboursements et versements', 'Règles de remboursement et d’annulation', 'Surveillance et sécurité de l’API'],
    checklistRows: ['Confirmer les variables d’environnement', 'Exécuter les migrations', 'Vérifier les images et les codes QR', 'Relire les textes en arabe et en anglais', 'Tester toutes les routes', 'Déployer en staging avant la production'],
  },
}

export function PlatformStatusPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [health, setHealth] = useState<PlatformHealth | null>(null)
  const [contracts, setContracts] = useState<PlatformContracts | null>(null)
  const [metrics, setMetrics] = useState<PlatformAdminMetrics | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void loadStatus()
  }, [])

  const cards = useMemo(
    () => [
      { label: t.service, value: health?.service || '-', state: health?.ok ? t.ok : t.issue },
      { label: t.database, value: isAr && health?.database.ok ? t.ok : health?.database.code || '-', state: health?.database.ok ? t.ok : t.issue },
      { label: t.endpoints, value: String(contracts?.endpoints.length || 0), state: t.ok },
      { label: t.security, value: String(contracts?.securityRules.length || 0), state: t.ok },
      { label: t.users, value: String(sumMap(metrics?.usersByRole || {})), state: t.ok },
      { label: t.listings, value: String(sumMap(metrics?.listingsByDivision || {})), state: t.ok },
      { label: t.bookings, value: String(sumMap(metrics?.bookingsByStatus || {})), state: t.ok },
      { label: t.rides, value: String(sumMap(metrics?.ridesByStatus || {})), state: t.ok },
      { label: t.payments, value: moneyText(metrics?.approvedPaymentVolumeMinor || 0, 'SYP', lang), state: t.ok },
      { label: t.wallet, value: moneyText(metrics?.walletBalanceMinor || 0, 'SYP', lang), state: t.ok },
    ],
    [contracts, health, isAr, lang, metrics, t],
  )

  async function loadStatus() {
    setStatus('loading')
    setMessage('')

    try {
      const [nextHealth, nextContracts, nextMetrics] = await Promise.all([
        fetchPrototypeHealth(),
        fetchPrototypeContracts(),
        fetchPrototypeAdminMetrics(),
      ])
      setHealth(nextHealth)
      setContracts(nextContracts)
      setMetrics(nextMetrics)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <section style={styles.hero}>
        <p style={styles.eyebrow}>SYBNB V6</p>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
        <button style={styles.primaryButton} onClick={() => void loadStatus()}>
          {status === 'loading' ? t.loading : t.refresh}
        </button>
      </section>

      {status === 'error' && <section style={styles.alert}>{message}</section>}

      <section style={styles.grid}>
        {cards.map((card) => (
          <article key={card.label} style={card.state === t.ok ? styles.cardOk : styles.cardWarn}>
            <span>{card.label}</span>
            <strong dir={isAr ? 'rtl' : 'ltr'}>{card.value}</strong>
            <b>{card.state}</b>
          </article>
        ))}
      </section>

      <section style={styles.readinessHero}>
        <article>
          <span>{t.readiness}</span>
          <strong>{t.demoReady}</strong>
          <p>{pick(lang, 'المنصة جاهزة للمراجعة النهائية وتجربة أصحاب المصلحة، مع فصل واضح لما يحتاج ربطاً إنتاجياً.', 'The platform is ready for final stakeholder review, with production integrations clearly separated.', 'La plateforme est prête pour la revue finale par les parties prenantes, avec une séparation claire des intégrations de production.')}</p>
        </article>
        <article style={styles.blockedBox}>
          <span>{t.productionBlocked}</span>
          <strong>{pick(lang, 'ليس بعد للمال الحقيقي', 'Not yet for real money', 'Pas encore pour de l’argent réel')}</strong>
          <p>{pick(lang, 'الإطلاق المالي يحتاج دفتر محفظة، ملفات، KYC، واسترداد/صرف حقيقي.', 'Real-money launch needs ledger, uploads, KYC, refunds, and payout release.', 'Un lancement avec de l’argent réel nécessite un registre, le téléversement de fichiers, la vérification KYC, les remboursements et le déblocage des versements.')}</p>
        </article>
      </section>

      <section style={styles.auditGrid}>
        <ReadinessPanel
          title={t.productionBlockers}
          tone="red"
          rows={t.blockerRows}
        />
        <ReadinessPanel
          title={t.deployChecklist}
          tone="gold"
          rows={t.checklistRows}
        />
        <ReadinessPanel
          title={t.securityControls}
          tone="green"
          rows={(contracts?.securityRules || []).slice(0, 6)}
        />
        <ReadinessPanel
          title={t.routeAudit}
          tone="blue"
          rows={[
            `${t.finalBuild}: ${status === 'error' ? t.issue : t.ok}`,
            `${t.staging}: ${pick(lang, 'مطلوب قبل الإنتاج', 'Required before production', 'Requis avant la production')}`,
            `${t.legalFinance}: ${pick(lang, 'مطلوب للمال الحقيقي', 'Required for real money', 'Requis pour l’argent réel')}`,
          ]}
        />
      </section>
    </main>
  )
}

function sumMap(items: Record<string, number>) {
  return Object.values(items).reduce((sum, value) => sum + value, 0)
}

function ReadinessPanel({ title, rows, tone }: { title: string; rows: readonly string[]; tone: 'red' | 'gold' | 'green' | 'blue' }) {
  return (
    <section style={{ ...styles.readinessPanel, borderColor: toneColor(tone, 0.45), background: toneColor(tone, 0.08) }}>
      <h2 style={styles.panelTitle}>{title}</h2>
      <div style={styles.rowStack}>
        {rows.length ? rows.map((row, index) => (
          <article key={`${row}-${index}`} style={styles.readinessRow}>
            <b style={{ color: toneColor(tone, 1) }}>{index + 1}</b>
            <span>{row}</span>
          </article>
        )) : <p style={styles.body}>-</p>}
      </div>
    </section>
  )
}

function toneColor(tone: 'red' | 'gold' | 'green' | 'blue', alpha: number) {
  const map = {
    red: `rgba(255, 95, 125, ${alpha})`,
    gold: `rgba(213, 169, 21, ${alpha})`,
    green: `rgba(32, 210, 155, ${alpha})`,
    blue: `rgba(82, 108, 255, ${alpha})`,
  }
  return map[tone]
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1060, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e1e2a', borderRadius: 8, padding: 18, background: '#111118', display: 'grid', gap: 12 },
  eyebrow: { color: '#d5a915', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: 0, fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 14px' },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' },
  cardOk: { border: '1px solid rgba(32,210,155,.45)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#b7ffe8', padding: 14, display: 'grid', gap: 6 },
  cardWarn: { border: '1px solid rgba(255,190,80,.5)', borderRadius: 8, background: 'rgba(255,190,80,.1)', color: '#ffe0a6', padding: 14, display: 'grid', gap: 6 },
  readinessHero: { display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, .7fr)' },
  blockedBox: { borderColor: 'rgba(255,95,125,.5)', background: 'rgba(255,95,125,.08)' },
  auditGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' },
  readinessPanel: { border: '1px solid #30384d', borderRadius: 8, padding: 14, display: 'grid', gap: 12 },
  panelTitle: { margin: 0, fontSize: 22 },
  rowStack: { display: 'grid', gap: 8 },
  readinessRow: { border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, background: 'rgba(0,0,0,.18)', padding: 12, display: 'grid', gap: 10, gridTemplateColumns: '28px minmax(0, 1fr)', alignItems: 'start', color: '#dbe3f4' },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
}
