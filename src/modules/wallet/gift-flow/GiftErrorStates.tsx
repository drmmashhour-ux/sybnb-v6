import React from 'react'

type Lang = 'ar' | 'en'
type GiftErrorState = 'wrong_phone' | 'already_redeemed' | 'expired' | 'blocked_admin' | 'security_review' | 'not_found'

type GiftErrorStatesProps = {
  lang?: Lang
  initialState?: GiftErrorState
  onPrimary?: (state: GiftErrorState) => void
  onSupport?: (state: GiftErrorState) => void
}

const COPY = {
  ar: {
    support: 'التواصل مع الدعم',
    stateLabels: {
      wrong_phone: 'رقم غير مطابق',
      already_redeemed: 'مستخدمة',
      expired: 'منتهية',
      blocked_admin: 'محظورة',
      security_review: 'مراجعة أمنية',
      not_found: 'غير موجودة',
    },
    states: {
      wrong_phone: {
        icon: '!',
        tone: '#ff5f76',
        title: 'هذا الرمز مقفل على رقم هاتف آخر',
        body: 'استخدم نفس رقم الهاتف الذي استلم الهدية، أو سجّل الدخول بالرقم الصحيح.',
        primary: 'تسجيل الدخول برقم مختلف',
      },
      already_redeemed: {
        icon: '✓',
        tone: '#8b95a7',
        title: 'تم استخدام الهدية مسبقاً',
        body: 'هذا الرمز أُضيف إلى محفظة مؤهلة ولا يمكن استخدامه مرة ثانية.',
        primary: 'فتح المحفظة',
      },
      expired: {
        icon: '⏱',
        tone: '#8b95a7',
        title: 'انتهت صلاحية الهدية',
        body: 'انتهت مدة المطالبة بهذه الهدية. يمكن التواصل مع المرسل أو الدعم.',
        primary: 'طلب مساعدة',
      },
      blocked_admin: {
        icon: '×',
        tone: '#ff5f76',
        title: 'تم حظر الهدية',
        body: 'أوقفت الإدارة هذه الهدية لحماية الحسابات والمحافظ.',
        primary: 'مراجعة الحالة',
      },
      security_review: {
        icon: '؟',
        tone: '#d5a915',
        title: 'الهدية قيد المراجعة الأمنية',
        body: 'تحتاج الإدارة إلى مراجعة قصيرة قبل إضافة الرصيد.',
        primary: 'متابعة الحالة',
      },
      not_found: {
        icon: '?',
        tone: '#8b95a7',
        title: 'لم يتم العثور على هذه الهدية',
        body: 'رابط الهدية غير صحيح أو منتهي. تأكد من الرابط أو تواصل مع من أرسل الهدية.',
        primary: 'المحاولة مرة أخرى',
      },
    },
  },
  en: {
    support: 'Contact support',
    stateLabels: {
      wrong_phone: 'Wrong phone',
      already_redeemed: 'Redeemed',
      expired: 'Expired',
      blocked_admin: 'Blocked',
      security_review: 'Security review',
      not_found: 'Not found',
    },
    states: {
      wrong_phone: {
        icon: '!',
        tone: '#ff5f76',
        title: 'This gift is locked to another phone number',
        body: 'Use the same phone number that received the gift, or sign in with the correct number.',
        primary: 'Sign in with another number',
      },
      already_redeemed: {
        icon: '✓',
        tone: '#8b95a7',
        title: 'Gift already redeemed',
        body: 'This code was already added to an eligible wallet and cannot be used again.',
        primary: 'Open wallet',
      },
      expired: {
        icon: '⏱',
        tone: '#8b95a7',
        title: 'Gift expired',
        body: 'The claim period for this gift has ended. Contact the sender or support.',
        primary: 'Get help',
      },
      blocked_admin: {
        icon: '×',
        tone: '#ff5f76',
        title: 'Gift blocked',
        body: 'Admin blocked this gift to protect accounts and wallets.',
        primary: 'Review status',
      },
      security_review: {
        icon: '?',
        tone: '#d5a915',
        title: 'Gift under security review',
        body: 'Admin needs a short review before adding the credit.',
        primary: 'Track status',
      },
      not_found: {
        icon: '?',
        tone: '#8b95a7',
        title: 'This gift could not be found',
        body: 'The gift link is invalid or expired. Check the link or contact whoever sent the gift.',
        primary: 'Try again',
      },
    },
  },
}

export function GiftErrorStates({ lang = 'ar', initialState = 'not_found', onPrimary, onSupport }: GiftErrorStatesProps) {
  const state = initialState
  const isAr = lang === 'ar'
  const t = COPY[lang]
  const active = t.states[state]

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', background: '#0a0a0f', color: '#f7f7fb', padding: 20, fontFamily: '"Cairo","Tajawal",Inter,sans-serif' }}>
      <section style={{ maxWidth: 500, margin: '0 auto', paddingTop: 24 }}>
        <div style={{ borderRadius: 24, border: `1px solid ${active.tone}66`, background: '#111118', padding: 24, textAlign: 'center' }}>
          <div style={{ width: 92, height: 92, borderRadius: 999, display: 'grid', placeItems: 'center', margin: '0 auto 18px', background: `${active.tone}1f`, color: active.tone, border: `1px solid ${active.tone}66`, fontSize: 42, fontWeight: 900 }}>
            {active.icon}
          </div>
          <h1 style={{ margin: 0, fontSize: 28 }}>{active.title}</h1>
          <p style={{ color: '#9aa6ba', lineHeight: 1.7 }}>{active.body}</p>
          <button type="button" onClick={() => onPrimary?.(state)} style={{ width: '100%', minHeight: 54, borderRadius: 16, border: 0, background: active.tone, color: '#081224', fontWeight: 900, fontSize: 16, marginTop: 12 }}>
            {active.primary}
          </button>
          <button type="button" onClick={() => onSupport?.(state)} style={{ width: '100%', minHeight: 54, borderRadius: 16, border: '1px solid #2c3448', background: '#111827', color: '#fff', fontWeight: 900, fontSize: 16, marginTop: 10 }}>
            {t.support}
          </button>
        </div>
      </section>
    </main>
  )
}

export default GiftErrorStates
