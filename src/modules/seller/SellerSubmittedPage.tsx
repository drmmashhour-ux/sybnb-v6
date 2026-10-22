import { useEffect, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo, BRAND_NAME, STAYS_ONLY } from '../../shared/brand'
import {
  fetchPrototypeListing,
  LAST_SUBMITTED_LISTING_KEY,
  type PlatformListing,
} from '../../shared/api/platformApi'
import { statusText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

export function SellerSubmittedPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const isAdvertisingFlow = typeof window !== 'undefined' && window.localStorage.getItem('sybnb_v6_sell_flow') === 'advertising'
  const [listing, setListing] = useState<PlatformListing | null>(() => readLastSubmittedListing())
  // Daily stays (and every listing in a stays-only build such as Rezekme Stay) follow the host path:
  // review -> activation code -> visible; there is no seller plan or seller dashboard.
  const isStay = STAYS_ONLY || listing?.division === 'STAYS'
  const advertisingReference = typeof window !== 'undefined' ? window.sessionStorage.getItem('sybnb_v6_ad_follow_code') : ''
  const reference = isAdvertisingFlow
    ? advertisingReference || 'ADV-S-2026-0042'
    : listing?.id
      ? `LST-${listing.id.slice(0, 8).toUpperCase()}`
      : 'LST-S-2026-0042'

  useEffect(() => {
    if (!listing?.id) return
    void fetchPrototypeListing(listing.id)
      .then((freshListing) => {
        setListing(freshListing)
        sessionStorage.setItem(LAST_SUBMITTED_LISTING_KEY, JSON.stringify(freshListing))
      })
      .catch(() => undefined)
  }, [listing?.id])

  return (
    <main className="seller-page seller-submitted-page" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="seller-submitted-card">
        <BrandLogo logo="plus" size="hero" />
        <div className="seller-success-mark">✓</div>
        <p className="eyebrow">{isAdvertisingFlow ? (isAr ? 'تم إرسال طلب الإعلان' : 'Advertising request sent') : isAr ? 'تم إرسال الإعلان' : 'Listing submitted'}</p>
        <h1>{isAdvertisingFlow ? (isAr ? 'طلبك الإعلاني الآن قيد المراجعة' : 'Your advertising request is now under review') : isAr ? 'إعلانك الآن قيد المراجعة' : 'Your listing is now under review'}</h1>
        <p>
          {isAdvertisingFlow
            ? isAr
              ? `سيقوم فريق ${BRAND_NAME} بمراجعة إثبات الدفع وملفات الإعلان. لا يظهر الإعلان قبل تأكيد الإدارة استلام المال والموافقة على الملفات.`
              : `The ${BRAND_NAME} team will review the payment proof and ad files. The ad will not run before admin confirms the money was received and approves the files.`
            : isStay
              ? isAr
                ? `سيراجع فريق ${BRAND_NAME} الإعلان وصورة الهوية. عند الموافقة نرسل إلى بريدك رمز تفعيل من 6 أرقام؛ أدخله في لوحة المضيف ليظهر إعلانك للضيوف.`
                : `The ${BRAND_NAME} team will review your listing and ID photo. When it is approved we email you a 6-digit activation code; enter it in your host dashboard and guests can see and book your stay.`
              : isAr
                ? `سيقوم فريق ${BRAND_NAME} بمراجعة المعلومات والمستندات. عند الموافقة، يتم فتح لوحة البائع ونشر الإعلان حسب الخطة.`
                : `The ${BRAND_NAME} team will review the information and documents. After approval, the seller dashboard opens and the listing publishes by plan.`}
        </p>
        <div className="seller-reference-card">
          <span>{isAr ? 'رقم المرجع' : 'Reference'}</span>
          <strong>{reference}</strong>
          {listing && (
            <small>
              {isAr ? 'حالة الإعلان' : 'Listing status'}: {sellerPublicationStatus(listing.status, lang)}
            </small>
          )}
        </div>
        <div className="seller-pipeline">
          {(isAdvertisingFlow
            ? isAr
              ? ['تم الاستلام', 'مطابقة الدفع', 'مراجعة ملفات الإعلان', 'منشور']
              : ['Received', 'Payment match', 'Ad file review', 'Published']
            : isStay
              ? isAr
                ? ['تم الاستلام', 'مراجعة الإعلان والهوية', 'رمز التفعيل بالبريد', 'ظاهر للضيوف']
                : ['Received', 'Listing and ID review', 'Activation code by email', 'Visible to guests']
              : isAr
                ? ['تم الاستلام', 'مراجعة الدفع والملفات', 'قرار الإدارة', 'منشور']
                : ['Received', 'Payment and file review', 'Admin decision', 'Published']
          ).map((item, index) => (
            <span key={item} className={index === 0 ? 'active' : ''}>
              {item}
            </span>
          ))}
        </div>
        <div className="seller-submitted-actions">
          {!isAdvertisingFlow && (
            <button
              className="seller-primary-button"
              onClick={() => navigate(isStay ? '/host/stays' : '/host/seller')}
            >
              {isStay ? (isAr ? 'فتح لوحة المضيف' : 'Open host dashboard') : isAr ? 'فتح لوحة البائع' : 'Open seller dashboard'}
            </button>
          )}
          <button className="seller-secondary-button" onClick={() => navigate(isAdvertisingFlow ? '/advertising/account' : '/sell/listing-wizard')}>
            {isAdvertisingFlow ? (isAr ? 'إضافة طلب إعلاني آخر' : 'Add another ad request') : isAr ? 'إضافة إعلان آخر' : 'Add another listing'}
          </button>
        </div>
      </section>
    </main>
  )
}

function sellerPublicationStatus(status: PlatformListing['status'], lang: Lang) {
  if (status === 'APPROVED') {
    return lang === 'ar' ? 'منشور' : 'Published'
  }

  return statusText(status, lang)
}

function readLastSubmittedListing() {
  try {
    const raw = sessionStorage.getItem(LAST_SUBMITTED_LISTING_KEY)
    return raw ? (JSON.parse(raw) as PlatformListing) : null
  } catch {
    return null
  }
}
