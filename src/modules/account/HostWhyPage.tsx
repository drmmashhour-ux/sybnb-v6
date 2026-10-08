import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { currentAccountIsHost, getStoredGuestSession } from '../../shared/api/platformApi'

// "Why host on SYBNB" — public host landing page (/host/why), open to signed-out visitors.
// Everything here describes what the code actually does today:
//  - Stays (STR) commission: STR_ADMIN_COMMISSION_RATE = 0.12 in server/lib/finance-ledger.mjs,
//    deducted from the host payout. Other divisions charge 0% per-booking commission and
//    monetize via the seller-plan fee instead (same file). Platform sale: 5% on close
//    (SellerEntryPage). If those values change, update this copy too.
//  - Payouts: the host share is held, then becomes eligible and is released (HostEarningsPage
//    statuses PENDING_HOLD / ELIGIBLE / RELEASED). Live payments are NOT enabled (AGENTS.md §5),
//    so the copy says so plainly and makes no promise about payout methods or timing.
//  - Terms are a DRAFT; we only point to /terms, never state legal/tax conclusions.
// "Start hosting" reuses the existing flow: /host/stays -> sign-in (App gate, returns here via
// returnPath) -> one-tap BecomeHostPage -> host profile -> dashboard.

type Props = { lang: Lang }

const STR_COMMISSION_PERCENT = 12
const PLATFORM_SALE_COMMISSION_PERCENT = 5

type Copy = {
  eyebrow: string
  title: string
  body: string
  cta: string
  ctaHost: string
  signedInAs: string
  howTitle: string
  how: Array<{ title: string; body: string }>
  whatTitle: string
  what: Array<{ title: string; body: string; path: string; action: string }>
  feesTitle: string
  fees: string[]
  feesNote: string
  payoutsTitle: string
  payoutsStatus: string
  payouts: string[]
  faqTitle: string
  faq: Array<{ q: string; a: string }>
  terms: string
  finalTitle: string
}

const copy: Record<Lang, Copy> = {
  ar: {
    eyebrow: 'الاستضافة على SYBNB',
    title: 'لماذا تستضيف على SYBNB؟',
    body: 'حساب واحد للحجز وللاستضافة. انشر إعلانك، استقبل الطلبات، وقرّر بنفسك من تقبل.',
    cta: 'ابدأ الاستضافة',
    ctaHost: 'افتح لوحة الاستضافة',
    signedInAs: 'مسجّل الدخول باسم',
    howTitle: 'كيف تعمل الاستضافة',
    how: [
      { title: 'أضف إعلانك', body: 'صور، سعر، قواعد، وموقع. قد يراجع فريق SYBNB الإعلان قبل ظهوره.' },
      { title: 'استقبل الطلبات', body: 'تصلك طلبات الحجز والرسائل في لوحة المضيف.' },
      { title: 'اقبل أو ارفض', body: 'أنت من يقرّر قبول الطلب أو رفضه.' },
      { title: 'احصل على مستحقاتك', body: 'تتابع حالة مستحقات كل حجز من صفحة الأرباح.' },
    ],
    whatTitle: 'ماذا يمكنك أن تعرض؟',
    what: [
      { title: 'إيجار يومي', body: 'شقق وبيوت للإقامات القصيرة.', path: '/host/stays', action: 'استضف إقامة' },
      { title: 'إيجار شهري', body: 'سكن طويل المدة مع تواصل المستأجرين عبر IMMOContact.', path: '/host', action: 'أضف إيجاراً شهرياً' },
      { title: 'بيع عقار', body: 'بِع بنفسك بخطة نشر، أو عبر المنصة.', path: '/sell', action: 'بيع عقار' },
      { title: 'المركبات', body: 'سيارات للبيع أو للإيجار.', path: '/host/cars', action: 'أضف مركبة' },
      { title: 'السوق', body: 'منتجات محلية.', path: '/host/marketplace', action: 'أضف منتجاً' },
    ],
    feesTitle: 'الرسوم',
    fees: [
      `الإيجار اليومي: عمولة خدمة ${STR_COMMISSION_PERCENT}% على كل حجز، تُخصم من مستحقاتك.`,
      'الإيجار الشهري، المركبات، السوق، والمشاريع الجديدة: لا عمولة على الحجز. قد تتطلب خطة نشر مدفوعة يظهر سعرها قبل الدفع.',
      `بيع عقار عبر المنصة: عمولة ${PLATFORM_SALE_COMMISSION_PERCENT}% عند إتمام البيع. البيع بنفسك يتم بخطة نشر.`,
    ],
    feesNote: 'هذه هي القيم المعتمدة حالياً في المنصة وقد تتغيّر. الشروط النهائية ستكون في اتفاقية المضيف.',
    payoutsTitle: 'المستحقات',
    payoutsStatus: 'الدفع الإلكتروني قيد الإعداد',
    payouts: [
      'الدفع الإلكتروني على SYBNB لم يُفعَّل بعد، ونحن نجهّزه.',
      'في الإيجار اليومي تُحجز حصتك لدى SYBNB بعد دفع الضيف، ثم تصبح جاهزة للصرف، ثم تُصرف.',
      'تظهر حالة كل حجز في صفحة الأرباح. سنعلن طرق الصرف ومواعيده قبل التفعيل.',
    ],
    faqTitle: 'أسئلة شائعة',
    faq: [
      { q: 'هل أحتاج إلى حساب ثانٍ؟', a: 'لا. نفس الحساب يصلح للحجز وللاستضافة، وتفعّل الاستضافة بنقرة واحدة.' },
      { q: 'هل يجب أن أقبل كل طلب؟', a: 'لا. تراجع كل طلب وتقبله أو ترفضه.' },
      { q: 'متى تُخصم العمولة؟', a: `في الإيجار اليومي تُخصم ${STR_COMMISSION_PERCENT}% من مستحقاتك عن كل حجز. لا تُدفع مقدماً.` },
      { q: 'هل يظهر إعلاني فوراً؟', a: 'قد يراجع فريق SYBNB الإعلانات والمستندات قبل نشرها.' },
      { q: 'أين الشروط؟', a: 'شروط المضيف ما زالت مسودة غير نهائية. يمكنك قراءة المسودة الحالية.' },
    ],
    terms: 'اقرأ مسودة الشروط',
    finalTitle: 'جاهز للبدء؟',
  },
  en: {
    eyebrow: 'Hosting on SYBNB',
    title: 'Why host on SYBNB',
    body: 'One account for booking and hosting. Publish your listing, receive requests, and decide who you accept.',
    cta: 'Start hosting',
    ctaHost: 'Open host dashboard',
    signedInAs: 'Signed in as',
    howTitle: 'How it works',
    how: [
      { title: 'List your place', body: 'Photos, price, rules, and location. The SYBNB team may review a listing before it goes live.' },
      { title: 'Receive requests', body: 'Booking requests and messages arrive in your host dashboard.' },
      { title: 'Accept or decline', body: 'You decide whether to accept or decline each request.' },
      { title: 'Get paid', body: 'Follow the payout status of each booking on your earnings page.' },
    ],
    whatTitle: 'What you can host',
    what: [
      { title: 'Short-term stays', body: 'Apartments and homes for short stays.', path: '/host/stays', action: 'Host a stay' },
      { title: 'Monthly rentals', body: 'Long-term homes, with renters contacting you through IMMOContact.', path: '/host', action: 'Add a monthly rental' },
      { title: 'Sell property', body: 'Sell it yourself with a publishing plan, or through the platform.', path: '/sell', action: 'Sell property' },
      { title: 'Cars', body: 'Vehicles for sale or rent.', path: '/host/cars', action: 'Add a vehicle' },
      { title: 'Marketplace', body: 'Local items.', path: '/host/marketplace', action: 'Add an item' },
    ],
    feesTitle: 'Fees',
    fees: [
      `Short-term stays: a ${STR_COMMISSION_PERCENT}% service commission on each booking, deducted from your payout.`,
      'Monthly rentals, cars, marketplace, and new construction: no per-booking commission. A paid publishing plan may apply; its price is shown before you pay.',
      `Selling property through the platform: ${PLATFORM_SALE_COMMISSION_PERCENT}% commission when the sale closes. Selling it yourself uses a publishing plan.`,
    ],
    feesNote: 'These are the values currently configured on the platform and may change. Final terms will be in the host agreement.',
    payoutsTitle: 'Payouts',
    payoutsStatus: 'Payments are being set up',
    payouts: [
      'Online payments on SYBNB are not live yet — we are still setting them up.',
      'For stays, your share is held by SYBNB after the guest pays, then becomes ready to release, then is released.',
      'Your earnings page shows the status of every booking. Payout methods and timing will be announced before payments go live.',
    ],
    faqTitle: 'FAQ',
    faq: [
      { q: 'Do I need a second account?', a: 'No. The same account works for booking and hosting; you turn on hosting with one tap.' },
      { q: 'Do I have to accept every request?', a: 'No. You review each request and accept or decline it.' },
      { q: 'When is the commission charged?', a: `For stays, ${STR_COMMISSION_PERCENT}% is deducted from your payout for each booking. Nothing is paid upfront.` },
      { q: 'Does my listing go live right away?', a: 'The SYBNB team may review listings and documents before they are published.' },
      { q: 'Where are the terms?', a: 'The host terms are still a draft and not final. You can read the current draft.' },
    ],
    terms: 'Read the draft terms',
    finalTitle: 'Ready to start?',
  },
  fr: {
    eyebrow: 'Accueillir sur SYBNB',
    title: 'Pourquoi accueillir sur SYBNB',
    body: 'Un seul compte pour réserver et accueillir. Publiez votre annonce, recevez des demandes et choisissez qui vous acceptez.',
    cta: 'Commencer à accueillir',
    ctaHost: 'Ouvrir le tableau de bord d’hôte',
    signedInAs: 'Connecté en tant que',
    howTitle: 'Comment ça marche',
    how: [
      { title: 'Publiez votre annonce', body: 'Photos, prix, règles et emplacement. L’équipe SYBNB peut vérifier une annonce avant sa mise en ligne.' },
      { title: 'Recevez des demandes', body: 'Les demandes de réservation et les messages arrivent dans votre tableau de bord d’hôte.' },
      { title: 'Acceptez ou refusez', body: 'Vous décidez d’accepter ou de refuser chaque demande.' },
      { title: 'Soyez payé', body: 'Suivez le statut du versement de chaque réservation sur votre page de revenus.' },
    ],
    whatTitle: 'Ce que vous pouvez proposer',
    what: [
      { title: 'Séjours courte durée', body: 'Appartements et maisons pour de courts séjours.', path: '/host/stays', action: 'Proposer un séjour' },
      { title: 'Location au mois', body: 'Logements longue durée ; les locataires vous contactent par IMMOContact.', path: '/host', action: 'Ajouter une location au mois' },
      { title: 'Vendre un bien', body: 'Vendez vous-même avec un forfait de publication, ou par la plateforme.', path: '/sell', action: 'Vendre un bien' },
      { title: 'Véhicules', body: 'Véhicules à vendre ou à louer.', path: '/host/cars', action: 'Ajouter un véhicule' },
      { title: 'Marché', body: 'Articles locaux.', path: '/host/marketplace', action: 'Ajouter un article' },
    ],
    feesTitle: 'Frais',
    fees: [
      `Séjours courte durée : une commission de service de ${STR_COMMISSION_PERCENT} % sur chaque réservation, déduite de votre versement.`,
      'Location au mois, véhicules, marché et projets neufs : aucune commission par réservation. Un forfait de publication payant peut s’appliquer ; son prix est affiché avant le paiement.',
      `Vente d’un bien par la plateforme : commission de ${PLATFORM_SALE_COMMISSION_PERCENT} % à la conclusion de la vente. La vente par vous-même passe par un forfait de publication.`,
    ],
    feesNote: 'Ce sont les valeurs actuellement configurées sur la plateforme ; elles peuvent changer. Les conditions définitives figureront dans l’entente d’hôte.',
    payoutsTitle: 'Versements',
    payoutsStatus: 'Paiements en cours de mise en place',
    payouts: [
      'Les paiements en ligne sur SYBNB ne sont pas encore actifs : nous les mettons en place.',
      'Pour les séjours, votre part est retenue par SYBNB après le paiement du voyageur, devient ensuite prête à verser, puis est versée.',
      'Votre page de revenus affiche le statut de chaque réservation. Les modes et délais de versement seront annoncés avant l’activation des paiements.',
    ],
    faqTitle: 'Questions fréquentes',
    faq: [
      { q: 'Ai-je besoin d’un deuxième compte ?', a: 'Non. Le même compte sert à réserver et à accueillir ; vous activez l’accueil en un geste.' },
      { q: 'Dois-je accepter toutes les demandes ?', a: 'Non. Vous examinez chaque demande et l’acceptez ou la refusez.' },
      { q: 'Quand la commission est-elle prélevée ?', a: `Pour les séjours, ${STR_COMMISSION_PERCENT} % sont déduits de votre versement pour chaque réservation. Rien n’est payé d’avance.` },
      { q: 'Mon annonce est-elle publiée immédiatement ?', a: 'L’équipe SYBNB peut vérifier les annonces et les documents avant leur publication.' },
      { q: 'Où sont les conditions ?', a: 'Les conditions d’hôte sont encore une ébauche non définitive. Vous pouvez lire l’ébauche actuelle.' },
    ],
    terms: 'Lire l’ébauche des conditions',
    finalTitle: 'Prêt à commencer ?',
  },
}

export function HostWhyPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const session = typeof window !== 'undefined' ? getStoredGuestSession() : null
  const isHost = typeof window !== 'undefined' && currentAccountIsHost()
  // Existing flow: signed-out -> App shows the sign-in gate with returnPath /host/stays;
  // signed-in non-host -> one-tap BecomeHostPage; host -> dashboard.
  const start = () => navigate('/host/stays')
  const ctaLabel = isHost ? t.ctaHost : t.cta

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <div style={styles.wrap}>
        <section style={{ ...styles.card, ...styles.hero }} aria-labelledby="host-why-title">
          <span style={styles.eyebrow}>{t.eyebrow}</span>
          <h1 id="host-why-title" style={styles.title}>{t.title}</h1>
          <p style={styles.body}>{t.body}</p>
          {session?.user ? (
            <p style={styles.muted}>
              {t.signedInAs} <strong dir="ltr">{session.user.email}</strong>
            </p>
          ) : null}
          <button style={styles.primary} onClick={start}>{ctaLabel}</button>
        </section>

        <section style={styles.card} aria-labelledby="host-why-how">
          <h2 id="host-why-how" style={styles.h2}>{t.howTitle}</h2>
          <ol style={styles.steps}>
            {t.how.map((step, index) => (
              <li key={step.title} style={styles.step}>
                <span style={styles.stepNum} aria-hidden="true">{index + 1}</span>
                <div>
                  <strong style={styles.itemTitle}>{step.title}</strong>
                  <p style={styles.small}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section style={styles.card} aria-labelledby="host-why-what">
          <h2 id="host-why-what" style={styles.h2}>{t.whatTitle}</h2>
          <div style={styles.grid}>
            {t.what.map((item) => (
              <article key={item.title} style={styles.tile}>
                <strong style={styles.itemTitle}>{item.title}</strong>
                <p style={styles.small}>{item.body}</p>
                <button style={styles.link} onClick={() => navigate(item.path)}>{item.action}</button>
              </article>
            ))}
          </div>
        </section>

        <section style={styles.card} aria-labelledby="host-why-fees">
          <h2 id="host-why-fees" style={styles.h2}>{t.feesTitle}</h2>
          <ul style={styles.list}>
            {t.fees.map((fee) => (
              <li key={fee} style={styles.listItem}>{fee}</li>
            ))}
          </ul>
          <p style={styles.muted}>{t.feesNote}</p>
        </section>

        <section style={styles.card} aria-labelledby="host-why-payouts">
          <div style={styles.rowBetween}>
            <h2 id="host-why-payouts" style={styles.h2}>{t.payoutsTitle}</h2>
            <span style={styles.badge}>{t.payoutsStatus}</span>
          </div>
          <ul style={styles.list}>
            {t.payouts.map((line) => (
              <li key={line} style={styles.listItem}>{line}</li>
            ))}
          </ul>
        </section>

        <section style={styles.card} aria-labelledby="host-why-faq">
          <h2 id="host-why-faq" style={styles.h2}>{t.faqTitle}</h2>
          <div style={styles.faqList}>
            {t.faq.map((item) => (
              <details key={item.q} style={styles.faq}>
                <summary style={styles.summary}>{item.q}</summary>
                <p style={styles.small}>{item.a}</p>
              </details>
            ))}
          </div>
          <button style={{ ...styles.link, justifySelf: 'start' }} onClick={() => navigate('/terms')}>{t.terms}</button>
        </section>

        <section style={{ ...styles.card, ...styles.hero }}>
          <h2 style={styles.h2}>{t.finalTitle}</h2>
          <button style={styles.primary} onClick={start}>{ctaLabel}</button>
        </section>
      </div>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: 'calc(100vh - 160px)', background: '#08090e', color: '#fff', padding: '24px 16px 90px', display: 'grid', alignContent: 'start', justifyItems: 'center' },
  wrap: { width: '100%', maxWidth: 760, display: 'grid', gap: 16 },
  card: { width: '100%', boxSizing: 'border-box', border: '1px solid #232638', borderRadius: 16, background: '#0e0f16', padding: 24, display: 'grid', gap: 14 },
  hero: { textAlign: 'center', justifyItems: 'center' },
  eyebrow: { color: '#9fb0ff', fontWeight: 800, fontSize: 13, letterSpacing: 0.4 },
  title: { margin: 0, fontSize: 30, fontWeight: 900 },
  h2: { margin: 0, fontSize: 20, fontWeight: 900 },
  body: { margin: 0, color: '#aab3c8', lineHeight: 1.7, maxWidth: 560 },
  muted: { margin: 0, color: '#9aa6ba', fontSize: 14, lineHeight: 1.6 },
  small: { margin: '4px 0 0', color: '#aab3c8', fontSize: 14, lineHeight: 1.6 },
  steps: { margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 },
  step: { display: 'grid', gridTemplateColumns: '34px 1fr', gap: 12, alignItems: 'start' },
  stepNum: { width: 34, height: 34, borderRadius: 999, background: '#5268ff', color: '#fff', fontWeight: 900, display: 'grid', placeItems: 'center' },
  itemTitle: { color: '#dce3ff', fontWeight: 800 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
  tile: { border: '1px solid #232638', borderRadius: 12, background: '#12131c', padding: 16, display: 'grid', gap: 6, alignContent: 'start' },
  list: { margin: 0, paddingInlineStart: 20, display: 'grid', gap: 8 },
  listItem: { color: '#dce3ff', lineHeight: 1.6 },
  rowBetween: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: 8, padding: '6px 10px', fontWeight: 900, fontSize: 12, background: 'rgba(229,184,11,.13)', color: '#e5b80b', border: '1px solid rgba(229,184,11,.42)' },
  faqList: { display: 'grid', gap: 8 },
  faq: { border: '1px solid #232638', borderRadius: 10, padding: '12px 14px', background: '#12131c' },
  summary: { cursor: 'pointer', fontWeight: 800, color: '#dce3ff' },
  primary: { minHeight: 54, minWidth: 220, border: 0, borderRadius: 10, background: '#5268ff', color: '#fff', fontWeight: 900, fontSize: 16, cursor: 'pointer', padding: '0 24px' },
  link: { justifySelf: 'start', border: 0, background: 'transparent', color: '#9fb0ff', fontWeight: 800, textDecoration: 'underline', cursor: 'pointer', padding: 0, textAlign: 'start' },
}
