import { useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../../shared/brand'
import { SELLER_ROLES } from './sellerData'
import type { SellerRoleId } from './sellerData'
import type { CSSVars } from '../../shared/theme/cssVars'

type Props = {
  lang: Lang
}

const STORAGE_KEY = 'sybnb_v6_selected_seller_role'
const FLOW_STORAGE_KEY = 'sybnb_v6_sell_flow'
type SellerServiceMode = 'seller-plan' | 'platform-sale'

const SELLER_SERVICE_MODES: Array<{
  id: SellerServiceMode
  accent: string
  label: Record<Lang, string>
  description: Record<Lang, string>
  nextStep: Record<Lang, string>
}> = [
  {
    id: 'seller-plan',
    accent: '#d5a915',
    label: { ar: 'بيع عقارك بنفسك', en: 'Sell your property yourself', fr: 'Vendez votre bien vous-même' },
    description: {
      ar: 'البائع يدفع خطة نشر، يرفع مستنداته، ثم يدير الإعلان والمتابعات من حسابه.',
      en: 'The seller pays a publishing plan, uploads documents, then manages the listing and leads from the account.',
      fr: 'Le vendeur paie un forfait de publication, téléverse ses documents, puis gère l’annonce et les demandes depuis son compte.',
    },
    nextStep: { ar: 'حساب + خطة + دفع + نشر', en: 'Account + plan + payment + publish', fr: 'Compte + forfait + paiement + publication' },
  },
  {
    id: 'platform-sale',
    accent: '#20d29b',
    label: { ar: 'بيع عبر المنصة', en: 'Sell through platform', fr: 'Vendre par la plateforme' },
    description: {
      ar: 'SYBNB تستلم الطلب والمستندات وتدير عملية البيع بعد موافقة الإدارة. لا توجد خطة نشر مقدماً؛ عمولة المنصة 5% عند إتمام البيع.',
      en: 'SYBNB receives the request and documents, then manages the sale after admin approval. No publishing plan is paid upfront; platform commission is 5% when the sale closes.',
      fr: 'SYBNB reçoit la demande et les documents, puis gère la vente après l’approbation de l’administration. Aucun forfait de publication n’est payé d’avance ; la commission de la plateforme est de 5 % à la conclusion de la vente.',
    },
    nextStep: { ar: 'حساب + مستندات + موافقة الإدارة + عمولة 5%', en: 'Account + documents + admin approval + 5% commission', fr: 'Compte + documents + approbation de l’administration + commission de 5 %' },
  },
]

export function SellerEntryPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const [selectedRole, setSelectedRole] = useState<SellerRoleId>('owner')
  const [serviceMode, setServiceMode] = useState<SellerServiceMode>('seller-plan')
  const selected = SELLER_ROLES.find((role) => role.id === selectedRole) ?? SELLER_ROLES[0]
  const selectedMode = SELLER_SERVICE_MODES.find((mode) => mode.id === serviceMode) ?? SELLER_SERVICE_MODES[0]

  const continueToAccount = () => {
    window.localStorage.setItem(STORAGE_KEY, selectedRole)
    window.localStorage.setItem(FLOW_STORAGE_KEY, serviceMode === 'platform-sale' ? 'platform-sale' : 'listing')
    navigate(serviceMode === 'platform-sale' ? '/sell/platform' : '/sell/account')
  }

  return (
    <main className="seller-page seller-entry-page" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="seller-hero">
        <button className="back-button seller-back" onClick={() => navigate('/')}>
          {pick(lang, 'رجوع', 'Back', 'Retour')}
        </button>
        <div className="seller-hero-grid">
          <div>
            <p className="eyebrow">{pick(lang, 'SYBNB / البائعون', 'SYBNB / Sellers', 'SYBNB / Vendeurs')}</p>
            <h1>{pick(lang, 'كيف تريد إدراج عقارك؟', 'How do you want to list your property?', 'Comment souhaitez-vous publier votre bien ?')}</h1>
            <p>
              {pick(
                lang,
                'لدينا مساران واضحان: بائع مع خطة يدير النشر بنفسه، أو بيع عبر المنصة حيث تساعد SYBNB في إدارة البيع بعد مراجعة الإدارة.',
                'We have two clear paths: a seller with a plan who manages publishing, or sell by platform where SYBNB helps manage the sale after admin review.',
                'Deux parcours clairs s’offrent à vous : un vendeur avec un forfait qui gère lui-même la publication, ou la vente par la plateforme, où SYBNB vous aide à gérer la vente après vérification par l’administration.',
              )}
            </p>
          </div>
          <div className="seller-logo-panel">
            <BrandLogo logo="plus" size="hero" />
            <span>{pick(lang, 'بيع آمن، نشر واضح، مراجعة إدارية', 'Safe sale, clear publishing, admin review', 'Vente sécurisée, publication claire, vérification administrative')}</span>
          </div>
        </div>
      </section>

      <section className="seller-design-note">
        <strong>{pick(lang, 'اختر المسار أولاً', 'Choose the path first', 'Choisissez d’abord le parcours')}</strong>
        <span>
          {pick(
            lang,
            'نفس كبسولة الحساب والدفع والمراجعة تعمل حسب المسار المختار.',
            'The same account, payment, and review capsule follows the selected path.',
            'Le même module de compte, de paiement et de vérification s’adapte au parcours choisi.',
          )}
        </span>
      </section>

      <section className="seller-role-grid seller-service-grid" aria-label={pick(lang, 'اختيار نوع البيع', 'Choose seller path', 'Choisir le parcours de vente')}>
        {SELLER_SERVICE_MODES.map((mode) => {
          const active = mode.id === serviceMode
          return (
            <button
              className={`seller-role-card ${active ? 'active' : ''}`}
              key={mode.id}
              onClick={() => setServiceMode(mode.id)}
              style={{ '--accent': mode.accent } as CSSVars}
            >
              <span className="seller-role-icon" aria-hidden="true">
                {mode.id === 'seller-plan' ? pick(lang, 'خ', 'P', 'F') : pick(lang, 'م', 'S', 'P')}
              </span>
              <span className="seller-role-title">{mode.label[lang]}</span>
              <span className="seller-role-copy">{mode.description[lang]}</span>
              <span className="seller-role-next">{mode.nextStep[lang]}</span>
            </button>
          )
        })}
      </section>

      <section className="seller-role-grid" aria-label={pick(lang, 'اختيار دور البائع', 'Choose seller role', 'Choisir le rôle du vendeur')}>
        {SELLER_ROLES.map((role) => {
          const active = role.id === selectedRole
          return (
            <button
              className={`seller-role-card ${active ? 'active' : ''}`}
              key={role.id}
              onClick={() => setSelectedRole(role.id)}
              style={{ '--accent': role.accent } as CSSVars}
            >
              <span className="seller-role-icon" aria-hidden="true">
                {role.shortLabel[lang].slice(0, 2)}
              </span>
              <span className="seller-role-title">{role.label[lang]}</span>
              <span className="seller-role-copy">{role.description[lang]}</span>
              <span className="seller-role-next">{role.nextStep[lang]}</span>
            </button>
          )
        })}
      </section>

      <section className="seller-action-panel" style={{ '--accent': selected.accent } as CSSVars}>
        <div>
          <p>{pick(lang, 'المسار المختار', 'Selected path', 'Parcours choisi')}</p>
          <strong>{selectedMode.label[lang]} - {selected.label[lang]}</strong>
          <span>{selectedMode.nextStep[lang]} / {selected.nextStep[lang]}</span>
        </div>
        <button className="seller-primary-button" onClick={continueToAccount}>
          {serviceMode === 'platform-sale'
            ? pick(lang, 'متابعة إلى البيع عبر المنصة', 'Continue to platform sale', 'Continuer vers la vente par la plateforme')
            : pick(lang, 'متابعة إلى الحساب والخطة', 'Continue to account and plan', 'Continuer vers le compte et le forfait')}
        </button>
      </section>
    </main>
  )
}
