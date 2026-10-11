import { useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'

type Props = { lang: Lang }
type Tri = { ar: string; en: string; fr: string }
type Guide = { key: string; icon: string; title: Tri; intro: Tri; steps: Tri[] }

const GUIDES: Guide[] = [
  {
    key: 'buy', icon: '🏠',
    title: { ar: 'دليل شراء عقار', en: 'Buying a property', fr: 'Acheter un bien' },
    intro: { ar: 'خطوات عملية لشراء منزل أو عقار عبر SYBNB بأمان.', en: 'Practical steps to buy a home safely through SYBNB.', fr: 'Étapes pour acheter en toute sécurité.' },
    steps: [
      { ar: 'ابحث واحفظ العقارات المناسبة، وفعّل التنبيهات لتصلك الإعلانات الجديدة.', en: 'Search and save suitable properties, and turn on alerts for new listings.', fr: 'Recherchez, sauvegardez et activez les alertes.' },
      { ar: 'استخدم حاسبة الأقساط لتقدير الدفعة الأولى والقسط الشهري.', en: 'Use the installment calculator to estimate your down payment and monthly cost.', fr: 'Estimez acompte et mensualité avec le calculateur.' },
      { ar: 'اطلب زيارة للعقار عبر زر «حجز زيارة» وتأكّد من حالته على الطبيعة.', en: 'Request a viewing with "Schedule a visit" and inspect the property in person.', fr: 'Demandez une visite et inspectez le bien.' },
      { ar: 'تحقّق من ملكية البائع ووثائق العقار قبل الاتفاق.', en: 'Verify the seller’s ownership and the property documents before agreeing.', fr: 'Vérifiez la propriété et les documents.' },
      { ar: 'اتفق على السعر والشروط، ثم أكمل النقل القانوني في السجل العقاري.', en: 'Agree on price and terms, then complete the legal transfer at the land registry.', fr: 'Convenez du prix puis finalisez le transfert légal.' },
      { ar: 'تعامل مع وسيط موثّق من دليل الوسطاء لمزيد من الأمان عند الحاجة.', en: 'Work with a verified broker from the agents directory for extra safety when needed.', fr: 'Faites appel à un courtier vérifié si besoin.' },
    ],
  },
  {
    key: 'rent', icon: '🔑',
    title: { ar: 'دليل الإيجار', en: 'Renting a home', fr: 'Louer un logement' },
    intro: { ar: 'كيف تجد سكناً مناسباً وتتفق مع المالك بثقة.', en: 'How to find the right home and agree with the owner confidently.', fr: 'Trouvez le bon logement en toute confiance.' },
    steps: [
      { ar: 'حدّد ميزانيتك الشهرية والمنطقة وعدد الغرف ثم ابحث.', en: 'Set your monthly budget, area and bedrooms, then search.', fr: 'Définissez budget, quartier et chambres.' },
      { ar: 'احفظ الإعلانات المفضّلة وفعّل التنبيهات.', en: 'Save your favourites and turn on alerts.', fr: 'Sauvegardez vos favoris et activez les alertes.' },
      { ar: 'تواصل مع المالك واطلب زيارة لمعاينة السكن.', en: 'Contact the owner and request a visit to view the home.', fr: 'Contactez le propriétaire et demandez une visite.' },
      { ar: 'اتفق على مدة الإيجار والتأمين وطريقة الدفع كتابةً.', en: 'Agree in writing on the lease term, deposit and payment method.', fr: 'Convenez par écrit de la durée, la caution et le paiement.' },
      { ar: 'وقّع عقد إيجار واضحاً واحتفظ بنسخة منه.', en: 'Sign a clear lease contract and keep a copy.', fr: 'Signez un bail clair et gardez une copie.' },
    ],
  },
  {
    key: 'sell', icon: '📣',
    title: { ar: 'دليل البيع والإعلان', en: 'Selling & listing', fr: 'Vendre & publier' },
    intro: { ar: 'انشر إعلانك على SYBNB وصِل إلى مشترين جادّين.', en: 'List on SYBNB and reach serious buyers.', fr: 'Publiez sur SYBNB et touchez des acheteurs sérieux.' },
    steps: [
      { ar: 'اختر دورك (مالك، وسيط، وكالة، مطوّر) والخطة المناسبة.', en: 'Choose your role (owner, broker, agency, developer) and the right plan.', fr: 'Choisissez votre rôle et votre forfait.' },
      { ar: 'جهّز صوراً واضحة وتفاصيل دقيقة وسعراً واقعياً.', en: 'Prepare clear photos, accurate details and a realistic price.', fr: 'Préparez photos, détails et un prix réaliste.' },
      { ar: 'حدّد ما حول العقار (مدارس، مواصلات، خدمات) لجذب الباحثين.', en: 'Add what’s nearby (schools, transport, services) to attract searchers.', fr: 'Ajoutez ce qui est à proximité.' },
      { ar: 'انشر الإعلان وانتظر مراجعته واعتماده.', en: 'Publish the listing and wait for review and approval.', fr: 'Publiez puis attendez la validation.' },
      { ar: 'ردّ بسرعة على الرسائل وطلبات الزيارة وأكّد المواعيد.', en: 'Respond quickly to messages and visit requests, and confirm times.', fr: 'Répondez vite aux messages et visites.' },
      { ar: 'أتمم البيع واتفق على الدفع بطريقة آمنة.', en: 'Close the deal and agree on a safe payment method.', fr: 'Concluez et convenez d’un paiement sûr.' },
    ],
  },
]

export function GuidesPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const [open, setOpen] = useState<string>('buy')
  return (
    <main style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <h1 style={styles.h1}>{pick(lang, 'أدلة الشراء والبيع والإيجار', 'Buying, selling & renting guides', 'Guides d’achat, vente et location')}</h1>
      <p style={styles.muted}>{pick(lang, 'إرشادات عملية لكل خطوة في رحلتك العقارية عبر SYBNB.', 'Practical guidance for every step of your real-estate journey on SYBNB.', 'Des conseils pratiques à chaque étape.')}</p>
      <div style={styles.tabs}>
        {GUIDES.map((g) => (
          <button key={g.key} type="button" onClick={() => setOpen(g.key)} style={{ ...styles.tab, ...(open === g.key ? styles.tabActive : {}) }}>
            <span aria-hidden="true">{g.icon}</span> {pick(lang, g.title.ar, g.title.en, g.title.fr)}
          </button>
        ))}
      </div>
      {GUIDES.filter((g) => g.key === open).map((g) => (
        <section key={g.key} style={styles.card}>
          <h2 style={styles.h2}>{g.icon} {pick(lang, g.title.ar, g.title.en, g.title.fr)}</h2>
          <p style={styles.muted}>{pick(lang, g.intro.ar, g.intro.en, g.intro.fr)}</p>
          <ol style={styles.steps}>
            {g.steps.map((s, i) => (
              <li key={i} style={styles.step}>
                <span style={styles.num}>{i + 1}</span>
                <span>{pick(lang, s.ar, s.en, s.fr)}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { maxWidth: 820, margin: '0 auto', padding: '24px 16px 48px', display: 'grid', gap: 10 },
  h1: { fontSize: 24, fontWeight: 800, color: '#0b1b3b', margin: 0 },
  h2: { fontSize: 19, fontWeight: 700, color: '#0b1b3b', margin: '0 0 6px' },
  muted: { color: '#64748b', fontSize: 14, margin: 0 },
  tabs: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  tab: { padding: '8px 14px', borderRadius: 999, border: '1px solid #c9d3e6', background: '#fff', color: '#0b1b3b', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  tabActive: { background: '#0b1b3b', color: '#fff', border: '2px solid #0b1b3b' },
  card: { border: '1px solid #e4e9f2', borderRadius: 16, padding: 18, background: '#fff', display: 'grid', gap: 12, marginTop: 6 },
  steps: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 },
  step: { display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 15, color: '#334155', lineHeight: 1.6 },
  num: { flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: '#eef2ff', color: '#2b5cff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 },
}
