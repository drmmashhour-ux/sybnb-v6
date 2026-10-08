import type { Lang } from '../../engines/language/languageEngine'

export type SellerRoleId = 'owner' | 'broker' | 'agency' | 'developer' | 'multi'
export type SellerPlanId = 'plus' | 'premium'

export type SellerRole = {
  id: SellerRoleId
  accent: string
  label: Record<Lang, string>
  shortLabel: Record<Lang, string>
  description: Record<Lang, string>
  nextStep: Record<Lang, string>
}

export type SellerPlan = {
  id: SellerPlanId
  accent: string
  name: string
  price: string
  label: Record<Lang, string>
  features: Array<Record<Lang, string>>
}

export const SELLER_ROLES: SellerRole[] = [
  {
    id: 'owner',
    accent: '#d5a915',
    label: { ar: 'مالك العقار', en: 'Property Owner', fr: 'Propriétaire' },
    shortLabel: { ar: 'مالك', en: 'Owner', fr: 'Propriétaire' },
    description: {
      ar: 'أملك العقار وأريد نشره مباشرة مع مستندات الملكية.',
      en: 'I own the property and want to list it directly with ownership documents.',
      fr: 'Je suis propriétaire du bien et je souhaite le publier directement avec les documents de propriété.',
    },
    nextStep: { ar: 'إثبات الملكية ثم تفاصيل العقار', en: 'Ownership proof, then listing details', fr: 'Preuve de propriété, puis détails de l’annonce' },
  },
  {
    id: 'broker',
    accent: '#526cff',
    label: { ar: 'وسيط بتفويض', en: 'Authorized Broker', fr: 'Courtier mandaté' },
    shortLabel: { ar: 'وسيط', en: 'Broker', fr: 'Courtier' },
    description: {
      ar: 'أمثل المالك وأضيف التفويض قبل نشر الإعلان.',
      en: 'I represent the owner and add authorization before publishing.',
      fr: 'Je représente le propriétaire et j’ajoute le mandat avant la publication.',
    },
    nextStep: { ar: 'تفويض المالك ثم معلومات التواصل', en: 'Owner authorization, then contact details', fr: 'Mandat du propriétaire, puis coordonnées' },
  },
  {
    id: 'agency',
    accent: '#19d7ff',
    label: { ar: 'مكتب عقاري', en: 'Real Estate Agency', fr: 'Agence immobilière' },
    shortLabel: { ar: 'مكتب', en: 'Agency', fr: 'Agence' },
    description: {
      ar: 'أدير عدة عقارات من حساب مكتب واحد ولوحة متابعة.',
      en: 'I manage multiple listings from one agency account and dashboard.',
      fr: 'Je gère plusieurs annonces depuis un seul compte d’agence et un tableau de bord.',
    },
    nextStep: { ar: 'بيانات المكتب ثم الخطة', en: 'Agency profile, then plan', fr: 'Profil de l’agence, puis forfait' },
  },
  {
    id: 'developer',
    accent: '#a772ff',
    label: { ar: 'مطوّر مشاريع', en: 'Project Developer', fr: 'Promoteur immobilier' },
    shortLabel: { ar: 'مطوّر', en: 'Developer', fr: 'Promoteur' },
    description: {
      ar: 'أرفع مشروع بناء جديد مع المخططات والطوابق والوحدات.',
      en: 'I upload a new construction project with plans, floors, and units.',
      fr: 'Je publie un nouveau projet de construction avec les plans, les étages et les unités.',
    },
    nextStep: { ar: 'خطة المطوّر ثم ملفات المشروع', en: 'Developer plan, then project files', fr: 'Forfait promoteur, puis fichiers du projet' },
  },
  {
    id: 'multi',
    accent: '#20d29b',
    label: { ar: 'بائع متعدد الأقسام', en: 'Multi-section Seller', fr: 'Vendeur multisection' },
    shortLabel: { ar: 'متعدد', en: 'Multi', fr: 'Multi' },
    description: {
      ar: 'أبيع سيارات أو منتجات أو أكثر من نوع إعلان داخل المنصة.',
      en: 'I sell cars, marketplace items, or more than one listing type.',
      fr: 'Je vends des voitures, des articles sur le marché ou plus d’un type d’annonce.',
    },
    nextStep: { ar: 'اختيار القسم ثم الخطة المناسبة', en: 'Choose division, then matching plan', fr: 'Choisir la section, puis le forfait adapté' },
  },
]

export const SELLER_PLANS: SellerPlan[] = [
  {
    id: 'plus',
    accent: '#d5a915',
    name: 'Plus',
    price: '$19',
    label: { ar: 'خطة Plus', en: 'Plus', fr: 'Plus' },
    features: [
      { ar: 'صور أكثر وظهور أفضل', en: 'More photos and better visibility', fr: 'Plus de photos et une meilleure visibilité' },
      { ar: 'طلبات زيارة وتواصل منظمة', en: 'Organized visit and contact requests', fr: 'Demandes de visite et de contact organisées' },
      { ar: 'مراجعة أسرع عند الازدحام', en: 'Faster review when queue is busy', fr: 'Vérification plus rapide en période d’affluence' },
    ],
  },
  {
    id: 'premium',
    accent: '#a772ff',
    name: 'Premium',
    price: '$49',
    label: { ar: 'خطة Premium', en: 'Premium', fr: 'Premium' },
    features: [
      { ar: 'ظهور مميز وتحليلات', en: 'Featured visibility and analytics', fr: 'Visibilité mise en avant et statistiques' },
      { ar: 'أدوات تسويق ومتابعة العملاء', en: 'Marketing and lead tools', fr: 'Outils de marketing et de suivi des clients potentiels' },
      { ar: 'أولوية مراجعة بعد السلامة', en: 'Priority review after safety checks', fr: 'Vérification prioritaire après les contrôles de sécurité' },
    ],
  },
]

export function pickSellerRole(id: string | null) {
  return SELLER_ROLES.find((role) => role.id === id) ?? SELLER_ROLES[0]
}
