import type { Lang } from '../../engines/language/languageEngine'
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_LOCAL } from '../../shared/support/contactChannels'

type Props = {
  lang: Lang
  page: 'terms' | 'privacy'
}

// Every figure and process described below (10% commission, the 3-day free-cancellation window,
// the $10 flat late-cancellation fee, the 3% protection premium, ID-document handling, manual
// Sham-Cash-style payment review) mirrors what server/lib/finance-ledger.mjs, server/routes/
// bookings.mjs, and server/lib/id-document-storage.mjs actually do -- not generic marketplace
// boilerplate. No registered company name/address exists anywhere in this project, so both pages
// refer to the operator only as "SYBNB" (per explicit instruction, pending real legal review).
// This is not a substitute for review by a licensed lawyer before being treated as binding.
const EFFECTIVE_DATE = { ar: '12 يوليو 2026', en: 'July 12, 2026' }

type Section = { heading: string; body: string }

const copy = {
  ar: {
    effectiveDatePrefix: 'تاريخ السريان: ',
    contact: (email: string, whatsapp: string) => `للاستفسار حول هذه الصفحة، تواصل معنا عبر البريد الإلكتروني ${email} أو واتساب ${whatsapp}.`,
    terms: {
      title: 'شروط الاستخدام',
      sections: [
        {
          heading: '١. عن سيبنب',
          body: 'سيبنب منصة حجوزات تربط الضيوف بالمضيفين الذين يعرضون وحدات إيجار قصيرة الأمد ("الإقامات") في سوريا، إضافة إلى خدمات النقل (سيبنب رايد) والسوق. سيبنب ليست مالكة أو مشغّلة لأي عقار أو مركبة معروضة؛ دورها هو تسهيل التواصل، والتحقق من الدفع، ومراجعة النزاعات بين الضيوف والمضيفين أو السائقين.',
        },
        {
          heading: '٢. الأهلية',
          body: 'يجب أن يكون عمرك 18 عاماً على الأقل وأن تكون قادراً على إبرام عقد ملزم لإنشاء حساب أو إجراء حجز.',
        },
        {
          heading: '٣. الحساب والتحقق',
          body: 'يتطلب إنشاء حساب ضيف، أو حساب مضيف أو سائق أو إداري، التحقق من بريدك الإلكتروني برمز لمرة واحدة يُرسل إليك قبل إنشاء الحساب أو تسجيل الدخول. الحسابات الإدارية (مضيف، سائق، إداري) تتطلب أيضاً نفس التحقق بالبريد الإلكتروني في كل عملية تسجيل دخول. تُخزَّن كلمات المرور عبر تجزئة تشفيرية أحادية الاتجاه — لا تصل سيبنب أبداً إلى كلمة مرورك الفعلية بعد ضبطها.',
        },
        {
          heading: '٤. التحقق من الهوية',
          body: 'قبل إتمام الدفع لبعض الحجوزات، قد يُطلب منك رفع وثيقة هوية رسمية (JPEG أو PNG أو PDF، بحد أقصى 8 ميغابايت). تُخزَّن هذه الوثيقة في مكان خاص غير قابل للوصول عبر الويب، ويُشار إليها برمز عشوائي فقط، ويراجعها فريق سيبنب للتأكد من أهلية الحجز.',
        },
        {
          heading: '٥. الحجز والدفع والعمولة',
          body: 'تتم معالجة الدفع لحجوزات الإقامة حالياً يدوياً: تُرسل إثبات الدفع (مثل إيصال تحويل عبر شام كاش)، ويراجعه فريق سيبنب ويوافق عليه قبل تأكيد حجزك. تحتفظ سيبنب بعمولة قدرها 10% من مبلغ الإيجار الأساسي لكل حجز إقامة مؤكَّد، ويُفصح عن ذلك لك قبل تأكيد الحجز، وللمضيفين بشكل منفصل عند إدراج عقاراتهم.',
        },
        {
          heading: '٦. الإلغاء والاسترداد',
          body: 'الحجوزات القياسية: يمكنك الإلغاء مجاناً في أي وقت حتى 3 أيام قبل تاريخ الدخول. الإلغاء خلال 3 أيام من تاريخ الدخول يستوجب رسماً إدارياً ثابتاً قدره 10 دولارات أمريكية، يُخصم من مبلغ الاسترداد. حماية الإلغاء: إذا اشتريت خدمة "حماية الإلغاء" (رسم إضافي غير قابل للاسترداد بنسبة 3% من الإيجار) عند الحجز، يمكنك الإلغاء دون رسم الـ10 دولارات في أي وقت حتى تاريخ الدخول؛ رسم الحماية نفسه لا يُسترد أبداً. تُصرف المبالغ المستردة كرصيد في محفظة سيبنب الخاصة بك، وليس كإرجاع إلى وسيلة الدفع الخارجية الأصلية.',
        },
        {
          heading: '٧. النزاعات',
          body: 'إذا واجهت مشكلة في حجز (مثل عدم مطابقة العقار لوصفه)، يمكنك فتح نزاع من صفحة حجزك. يراجع فريق سيبنب الإداري الحجوزات المتنازع عليها، وسيتواصل معك ومع الطرف الآخر عبر بيانات التواصل المسجلة.',
        },
        {
          heading: '٨. مسؤوليات المضيف والسائق',
          body: 'يتحمل المضيفون والسائقون مسؤولية دقة معلومات إعلاناتهم أو مركباتهم، والالتزام بالحجوزات أو الرحلات المؤكدة. تحتفظ سيبنب بحق إزالة الإعلانات أو تعليق الحسابات أو حجز المدفوعات ريثما تتم المراجعة، إذا كان لدينا سبب معقول للاعتقاد بمخالفة هذه الشروط.',
        },
        {
          heading: '٩. السلوك المحظور',
          body: 'توافق على عدم: تقديم وثائق هوية أو دفع مزيفة؛ محاولة تجاوز إجراءات التحقق من الدفع في سيبنب؛ مضايقة مستخدمين آخرين؛ أو استخدام المنصة لأي غرض غير قانوني.',
        },
        {
          heading: '١٠. التعديلات على هذه الشروط',
          body: 'قد نحدّث هذه الشروط مع تطور المنصة، وسنشير إلى تاريخ السريان أعلاه عند ذلك. استمرارك في استخدام سيبنب بعد أي تحديث يعني موافقتك على الشروط المعدَّلة.',
        },
      ] satisfies Section[],
    },
    privacy: {
      title: 'سياسة الخصوصية',
      sections: [
        {
          heading: '١. المعلومات التي نجمعها',
          body: 'معلومات الحساب: البريد الإلكتروني، الاسم المعروض، ورقم الهاتف إن قدّمته (نخزّن فقط تجزئة تشفيرية أحادية الاتجاه لرقم هاتفك، وليس الرقم نفسه). كلمة مرورك تُخزَّن فقط كتجزئة تشفيرية أحادية الاتجاه — لا يمكننا قراءتها أو استرجاعها. وثائق الهوية التي ترفعها للتحقق من الحجز (تُخزَّن في مكان خاص غير قابل للوصول عبر الويب، ويراجعها فريق سيبنب فقط). إثبات الدفع (مثل لقطة شاشة لتحويل عبر شام كاش) الذي تقدّمه لتأكيد دفع حجزك. الرسائل التي ترسلها عبر نظام المراسلة داخل التطبيق تُخزَّن كما أُرسلت، لإتاحة مراجعتها من الدعم في حال نشوء نزاع. ونشاط الحجوزات والإعلانات والمحفظة والرحلات المرتبط بحسابك.',
        },
        {
          heading: '٢. كيف نستخدم هذه المعلومات',
          body: 'لإنشاء حسابك وتأمينه (رموز التحقق بالبريد الإلكتروني)، وتأكيد دفعات الحجوزات، والتحقق من وثائق الهوية عند الاقتضاء، وحل النزاعات، وحساب المدفوعات والعمولات، وتقديم الدعم لك.',
        },
        {
          heading: '٣. كيف نحميها',
          body: 'لا تُخزَّن كلمات المرور وأرقام الهواتف أبداً بصيغة قابلة للقراءة. تُخزَّن وثائق الهوية خارج أي مجلد قابل للوصول عبر الويب، ويُشار إليها برمز عشوائي فقط، وليس باسمك أو رقم حسابك. يمكن إبطال جلسات الدخول (مثلاً عند تسجيل الخروج أو إعادة تعيين كلمة المرور)، ويتطلب كل حساب التحقق بالبريد الإلكتروني.',
        },
        {
          heading: '٤. مع من نشاركها',
          body: 'لا نبيع معلوماتك الشخصية. يرى المضيفون معلومات الضيف اللازمة لإتمام حجز مؤكد (الاسم، وبيانات التواصل التي قدمتها لذلك الحجز). قد نفصح عن معلومات إذا اقتضى القانون ذلك.',
        },
        {
          heading: '٥. مدة الاحتفاظ بالبيانات',
          body: 'نحتفظ ببيانات حسابك وحجوزاتك طالما كان حسابك نشطاً، وبالقدر اللازم لحل أي نزاعات مفتوحة، أو إتمام المدفوعات، أو الوفاء بالالتزامات القانونية.',
        },
        {
          heading: '٦. حقوقك',
          body: 'لطلب الوصول إلى بياناتك الشخصية أو تصحيحها أو حذفها، تواصل معنا عبر البريد الإلكتروني أو واتساب أدناه. سنستجيب لطلبك بأسرع ما يمكننا بشكل معقول؛ وقد يلزم الاحتفاظ ببعض المعلومات (مثل سجلات نزاع مفتوح أو دفعة مكتملة) حتى بعد طلب الحذف.',
        },
        {
          heading: '٧. التعديلات على هذه السياسة',
          body: 'قد نحدّث سياسة الخصوصية هذه مع تطور المنصة؛ وسيعكس تاريخ السريان أعلاه أحدث نسخة.',
        },
      ] satisfies Section[],
    },
  },
  en: {
    effectiveDatePrefix: 'Effective date: ',
    contact: (email: string, whatsapp: string) => `For any question about this page, reach us by email at ${email} or WhatsApp ${whatsapp}.`,
    terms: {
      title: 'Terms of Service',
      sections: [
        {
          heading: '1. About SYBNB',
          body: 'SYBNB is a booking platform connecting guests with hosts offering short-term rental accommodations ("Stays") in Syria, alongside related transport (SYBNB Ride) and marketplace services. SYBNB does not own or operate any listed property or vehicle; it facilitates the connection, payment verification, and dispute review between guests and hosts or drivers.',
        },
        {
          heading: '2. Eligibility',
          body: 'You must be at least 18 years old and able to form a binding contract to create an account or make a booking.',
        },
        {
          heading: '3. Account & verification',
          body: 'Creating a guest account, or a host/driver/admin account, requires verifying your email address with a one-time code sent to you before the account is created or you can sign in. Staff accounts (host, driver, admin) also require the same email verification on every sign-in. Passwords are stored using one-way cryptographic hashing — SYBNB never has access to your actual password after you set it.',
        },
        {
          heading: '4. ID verification',
          body: 'Before completing payment for certain bookings, you may be asked to upload a government ID document (JPEG, PNG, or PDF, maximum 8MB). This document is stored in a private location that is not accessible from the web, referenced only by a random identifier, and is reviewed by the SYBNB team to confirm booking eligibility.',
        },
        {
          heading: '5. Booking, payment & commission',
          body: 'Payment for Stays bookings is currently processed manually: you submit proof of payment (for example, a Sham Cash transfer receipt), which the SYBNB team reviews and approves before your booking is confirmed. SYBNB retains a 10% commission on the base rent portion of every confirmed Stays booking; this is disclosed to you before you confirm a booking, and separately to hosts when they list a property.',
        },
        {
          heading: '6. Cancellations & refunds',
          body: 'Standard bookings: you may cancel free of charge any time until 3 days before check-in. Cancelling within 3 days of check-in incurs a flat $10 USD administrative fee, deducted from your refund. Cancellation Protection: if you purchase Cancellation Protection (a non-refundable 3% premium on the rent) at booking time, you may cancel free of the $10 fee at any time up to check-in; the protection premium itself is never refunded. Refunds are issued as a credit to your SYBNB wallet, not a reversal to your original external payment method.',
        },
        {
          heading: '7. Disputes',
          body: 'If a problem arises with a booking (for example, a listing not matching its description), you can raise a dispute from your booking page. Disputed bookings are reviewed by the SYBNB admin team, who will contact you and the other party using the details on file.',
        },
        {
          heading: '8. Host & driver responsibilities',
          body: 'Hosts and drivers are responsible for the accuracy of their listing/vehicle information and for honoring confirmed bookings/rides. SYBNB reserves the right to remove listings, suspend accounts, or withhold payouts pending review if we reasonably believe these Terms have been violated.',
        },
        {
          heading: '9. Prohibited conduct',
          body: 'You agree not to: provide false identity or payment documents; attempt to bypass SYBNB’s payment-verification process; harass other users; or use the platform for any unlawful purpose.',
        },
        {
          heading: '10. Changes to these Terms',
          body: 'We may update these Terms as the platform evolves; the effective date above will reflect the latest version. Continuing to use SYBNB after an update means you accept the revised Terms.',
        },
      ] satisfies Section[],
    },
    privacy: {
      title: 'Privacy Policy',
      sections: [
        {
          heading: '1. Information we collect',
          body: 'Account information: your email address, display name, and — if provided — a phone number (we store only a one-way cryptographic hash of your phone number, never the number itself). Your password, stored only as a one-way cryptographic hash — we cannot read or recover your actual password. ID documents you upload for booking verification (stored in a private, non-web-accessible location and reviewed only by SYBNB staff). Payment proof (e.g. a Sham Cash transfer screenshot) you submit to confirm a booking payment. Messages sent through SYBNB’s in-app messaging are stored as submitted, to allow support review if a dispute arises. Booking, listing, wallet, and ride activity connected to your account.',
        },
        {
          heading: '2. How we use this information',
          body: 'To create and secure your account (email verification codes), confirm booking payments, verify ID documents where required, resolve disputes, calculate payouts and commission, and provide customer support.',
        },
        {
          heading: '3. How we protect it',
          body: 'Passwords and phone numbers are never stored in readable form. ID documents are stored outside any web-accessible directory and referenced only by a random identifier, not your name or account ID. Sessions can be revoked (for example, when you log out or reset your password), and every account requires email verification.',
        },
        {
          heading: '4. Who we share it with',
          body: 'We do not sell your personal information. Hosts see the guest information necessary to fulfil a confirmed booking (name, and contact details you’ve provided for that booking). We may disclose information if required by law.',
        },
        {
          heading: '5. Data retention',
          body: 'We keep your account and booking data for as long as your account is active, and as needed to resolve any open disputes, complete payouts, or meet legal obligations.',
        },
        {
          heading: '6. Your rights',
          body: 'To request access to, correction of, or deletion of your personal data, contact us by email or WhatsApp below. We will respond as quickly as we reasonably can; some information (for example, records needed for an open dispute or a completed payout) may need to be retained even after a deletion request.',
        },
        {
          heading: '7. Changes to this Policy',
          body: 'We may update this Privacy Policy as the platform evolves; the effective date above will reflect the latest version.',
        },
      ] satisfies Section[],
    },
  },
}

export function LegalPlaceholderPage({ lang, page }: Props) {
  const isAr = lang === 'ar'
  const t = copy[lang]
  const section = t[page]

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <article style={styles.card}>
        <h1 style={styles.title}>{section.title}</h1>
        <p style={styles.effectiveDate}>{t.effectiveDatePrefix}{EFFECTIVE_DATE[lang]}</p>
        {section.sections.map((entry) => (
          <section key={entry.heading} style={styles.section}>
            <h2 style={styles.heading}>{entry.heading}</h2>
            <p style={styles.body}>{entry.body}</p>
          </section>
        ))}
        <p style={styles.contact}>{t.contact(SUPPORT_EMAIL, SUPPORT_WHATSAPP_LOCAL)}</p>
      </article>
    </main>
  )
}

const styles = {
  page: {
    display: 'flex',
    justifyContent: 'center',
    padding: '48px 16px',
  },
  card: {
    background: '#0d1322',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14,
    maxWidth: 720,
    padding: '32px 28px',
    width: '100%',
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 950,
    margin: '0 0 6px',
  },
  effectiveDate: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    margin: '0 0 24px',
  },
  section: {
    margin: '0 0 22px',
  },
  heading: {
    color: '#f4d676',
    fontSize: 15,
    fontWeight: 800,
    margin: '0 0 8px',
  },
  body: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 14.5,
    lineHeight: 1.7,
    margin: 0,
  },
  contact: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    lineHeight: 1.6,
    margin: '8px 0 0',
    paddingTop: 16,
    borderTop: '1px solid rgba(255,255,255,0.08)',
  },
} as const
