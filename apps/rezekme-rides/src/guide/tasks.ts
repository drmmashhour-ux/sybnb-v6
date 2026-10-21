import type { Lang } from '@platform/engines/language/languageEngine'

/**
 * Guided tasks for the in-app AI helper. The helper (server AI, or the keyword matcher below when there is no AI key)
 * can only pick a task id from this fixed list; it then walks the person through the real screens step by step:
 * it opens the page, points at the control, and waits for the person to act. It only auto-clicks harmless selectors
 * (tabs / toggles marked `open`), NEVER a button that sends, pays, submits or confirms anything.
 */
export type Tri = { ar: string; en: string; fr: string }
export type GuideStep = {
  /** Hash route to open first (e.g. '/ride'). */
  route?: string
  /** CSS selector of the control to point at (data-guide attributes). Missing target => the bubble is centred. */
  target?: string
  /** Harmless element to click automatically when the step starts (a tab or a toggle). */
  open?: string
  text: Tri
}
export type GuideTask = { id: string; role: 'rider' | 'driver'; title: Tri; keywords: string[]; steps: GuideStep[] }

const t = (ar: string, en: string, fr: string): Tri => ({ ar, en, fr })

export const GUIDE_TASKS: GuideTask[] = [
  {
    id: 'refill-wallet', role: 'rider',
    title: t('شحن المحفظة', 'Refill my wallet', 'Recharger mon portefeuille'),
    keywords: ['wallet', 'refill', 'top up', 'topup', 'top-up', 'add money', 'add funds', 'balance', 'sham', 'recharge', 'portefeuille', 'solde', 'رصيد', 'محفظ', 'شحن', 'اشحن', 'شام كاش', 'ادفع', 'دفع'],
    steps: [
      { route: '/ride', text: t('سنشحن محفظتك خطوة بخطوة. أنت من يرسل التحويل، وأنا أرشدك.', 'Let us refill your wallet step by step. You send the transfer; I will show you where.', 'Rechargeons votre portefeuille pas à pas. Vous envoyez le virement, je vous montre où.') },
      { route: '/ride', target: '[data-guide="pay-tab-shamcash"]', open: '[data-guide="pay-tab-shamcash"]', text: t('اخترنا لك «Sham Cash». الدفع قبل الرحلة من المحفظة.', 'I selected “Sham Cash” for you. Rides are paid from the wallet before the trip.', 'J’ai sélectionné « Sham Cash ». Les courses sont payées par le portefeuille avant le trajet.') },
      { route: '/ride', target: '[data-guide="shamcash-qr"]', text: t('افتح تطبيق Sham Cash وحوّل المبلغ إلى هذا الحساب (امسح الرمز).', 'Open your Sham Cash app and send the amount to this account (scan the code).', 'Ouvrez Sham Cash et envoyez le montant à ce compte (scannez le code).') },
      { route: '/ride', target: '[data-guide="shamcash-ref"]', text: t('اكتب رقم مرجع التحويل الذي ظهر لك في Sham Cash.', 'Type the transfer reference number that Sham Cash gave you.', 'Saisissez le numéro de référence donné par Sham Cash.') },
      { route: '/ride', target: '[data-guide="shamcash-submit"]', text: t('اضغط «إرسال إثبات الدفع». لن يُشحن رصيدك حتى يتأكد المشرف أن المال وصل.', 'Press “Submit payment proof”. Your wallet is credited only after an admin confirms the money arrived.', 'Appuyez sur « Envoyer la preuve ». Le portefeuille est crédité seulement après confirmation par l’administrateur.') },
      { text: t('تم. عندما يوافق المشرف سيُضاف الرصيد تلقائياً ويُفعَّل زر طلب الرحلة.', 'Done. When the admin approves, the balance appears and Request ride unlocks.', 'Terminé. Après l’approbation, le solde apparaît et le bouton Demander le trajet se débloque.') },
    ],
  },
  {
    id: 'report-problem', role: 'rider',
    title: t('الإبلاغ عن مشكلة في رحلة', 'Report a problem with a trip', 'Signaler un problème'),
    keywords: ['problem', 'report', 'complain', 'complaint', 'refund', 'wrong', 'overcharged', 'dispute', 'issue', 'مشكلة', 'ابلاغ', 'إبلاغ', 'شكوى', 'استرداد', 'غلط', 'problème', 'signaler', 'remboursement'],
    steps: [
      { route: '/trips', text: t('هذه رحلاتك. سنفتح بلاغاً على رحلة مكتملة.', 'These are your trips. We will report a completed one.', 'Voici vos courses. Nous allons en signaler une terminée.') },
      { route: '/trips', target: '[data-guide="report-problem"]', text: t('اضغط «الإبلاغ عن مشكلة» تحت الرحلة المعنية.', 'Press “Report a problem” under the trip.', 'Appuyez sur « Signaler un problème » sous la course.') },
      { route: '/trips', target: '[data-guide="report-text"]', text: t('اشرح ما حدث بجملة أو جملتين ثم أرسل. الإدارة هي التي تقرر أي استرداد.', 'Describe what happened in a sentence or two, then send. Only the admin decides a refund.', 'Décrivez ce qui s’est passé puis envoyez. Seul l’administrateur décide d’un remboursement.') },
    ],
  },
  {
    id: 'driver-payout', role: 'driver',
    title: t('سحب أرباحي', 'Withdraw my earnings', 'Retirer mes gains'),
    keywords: ['payout', 'withdraw', 'earnings', 'get paid', 'my money', 'cash out', 'pay me', 'سحب', 'ارباح', 'أرباح', 'استلم', 'فلوس', 'قبض', 'retrait', 'gains', 'paiement'],
    steps: [
      { route: '/driver', text: t('سنطلب سحب أرباحك. الإدارة تحوّل لك عبر Sham Cash وتسجّل المرجع.', 'Let us request a payout. The admin sends it by Sham Cash and records the reference.', 'Demandons un retrait. L’administrateur l’envoie par Sham Cash et note la référence.') },
      { route: '/driver', target: '[data-guide="payout-amount"]', text: t('اكتب المبلغ المراد سحبه (ضمن الرصيد المتاح).', 'Type the amount to withdraw (up to your available balance).', 'Saisissez le montant à retirer (dans la limite du solde disponible).') },
      { route: '/driver', target: '[data-guide="payout-wallet"]', text: t('اكتب اسمك ورقم محفظة Sham Cash التي تريد الاستلام عليها.', 'Enter your name and the Sham Cash wallet number to receive on.', 'Entrez votre nom et le numéro Sham Cash de réception.') },
      { route: '/driver', target: '[data-guide="payout-submit"]', text: t('اضغط «اطلب السحب». ستظهر الحالة في القائمة تحته.', 'Press “Request payout”. The status appears in the list below.', 'Appuyez sur « Demander le retrait ». Le statut apparaît dans la liste.') },
    ],
  },
  {
    id: 'driver-report', role: 'driver',
    title: t('الإبلاغ عن مشكلة في رحلة', 'Report a problem with a trip', 'Signaler un problème'),
    keywords: ['problem', 'report', 'complain', 'dispute', 'rider', 'issue', 'مشكلة', 'ابلاغ', 'إبلاغ', 'شكوى', 'راكب', 'problème', 'signaler'],
    steps: [
      { route: '/driver', target: '[data-guide="report-problem"]', text: t('اضغط «الإبلاغ عن مشكلة» تحت الرحلة المكتملة ثم اشرح ما حدث.', 'Press “Report a problem” under the completed trip, then explain what happened.', 'Appuyez sur « Signaler un problème » sous la course terminée puis expliquez.') },
    ],
  },
]

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا')

/** Offline keyword matcher (used when the server AI is off or returns no task). Returns the best task for the role or null. */
export function matchGuideTask(question: string, role: 'rider' | 'driver'): GuideTask | null {
  const q = norm(question)
  let best: GuideTask | null = null
  let bestScore = 0
  for (const task of GUIDE_TASKS) {
    if (task.role !== role) continue
    const score = task.keywords.reduce((n, k) => (q.includes(norm(k)) ? n + 1 : n), 0)
    if (score > bestScore) { best = task; bestScore = score }
  }
  return best
}

export const taskById = (id: string | null | undefined, role: 'rider' | 'driver') => GUIDE_TASKS.find((x) => x.id === id && x.role === role) ?? null
export const guideLabel = (tri: Tri, lang: Lang) => tri[lang] ?? tri.en
export const GUIDE_TASK_IDS = (role: 'rider' | 'driver') => GUIDE_TASKS.filter((x) => x.role === role).map((x) => ({ id: x.id, title: x.title.en }))
