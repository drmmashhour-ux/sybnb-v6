import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchMyMshRewardsPreview } from '../../shared/api/platformApi'
import { calculateRewardsDraft, type MshRewardActivity } from './mshRewardsDraft'

export function MshRewardsPreview({ lang }: { lang: Lang }) {
  const t = (en: string, ar: string, fr: string) => lang === 'ar' ? ar : lang === 'fr' ? fr : en
  const [activity, setActivity] = useState<MshRewardActivity | null>(null)
  const [stay, setStay] = useState(''), [ride, setRide] = useState('')
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const [result, setResult] = useState<ReturnType<typeof calculateRewardsDraft> | null>(null)
  const [invalid, setInvalid] = useState(false)
  const mounted = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    mounted.current = true
    const reset = () => { generation.current++; setActivity(null); setResult(null); setBusy(false); setFailed(false); setStay(''); setRide('') }
    window.addEventListener('sybnb-session-changed', reset)
    return () => { mounted.current = false; generation.current++; window.removeEventListener('sybnb-session-changed', reset) }
  }, [])
  async function refresh() {
    const requestId = ++generation.current
    setBusy(true); setFailed(false); setActivity(null); setResult(null)
    try { const next = await fetchMyMshRewardsPreview(); if (mounted.current && requestId === generation.current) setActivity(next) }
    catch { if (mounted.current && requestId === generation.current) setFailed(true) }
    finally { if (mounted.current && requestId === generation.current) setBusy(false) }
  }
  function preview(event: React.FormEvent) {
    event.preventDefault(); setInvalid(false); setResult(null)
    if (!activity) return
    try { setResult(calculateRewardsDraft(activity, stay, ride)) } catch { setInvalid(true) }
  }
  return <section className="msh-dashboard-contract msh-rewards-preview" aria-label={t('MSH rewards draft', 'مسودة مكافآت MSH', 'Brouillon des récompenses MSH')}>
    <h2>{t('Configure test rewards', 'إعداد المكافآت التجريبية', 'Configurer les récompenses de test')}</h2>
    <p><strong>{t('Draft only · Rewards disabled', 'مسودة فقط · المكافآت معطلة', 'Brouillon uniquement · Récompenses désactivées')}</strong></p>
    <p>{t('Choose an earning rule and preview your completed activity. Preview units have no cash value and are not issued MSH tokens. No wallet connection is needed.', 'اختر قاعدة للمكافآت وعاين نشاطك المكتمل. وحدات المعاينة بلا قيمة نقدية وليست رموز MSH مُصدرة. لا يلزم اتصال بمحفظة.', 'Choisissez une règle et prévisualisez votre activité terminée. Les unités de prévisualisation n’ont aucune valeur monétaire et ne sont pas des jetons MSH émis. Aucun portefeuille requis.')}</p>
    <button disabled={busy} onClick={() => void refresh()}>{busy ? t('Loading activity…', 'جارٍ تحميل النشاط…', 'Chargement…') : t('Load completed activity', 'تحميل النشاط المكتمل', 'Charger l’activité terminée')}</button>
    {failed && <p role="alert">{t('Activity could not be loaded. Sign in and retry.', 'تعذر تحميل النشاط. سجل الدخول وأعد المحاولة.', 'Impossible de charger l’activité. Connectez-vous et réessayez.')}</p>}
    {activity && <>
      {activity.truncated && <p>{t('Showing only the latest 100 completed stays and 100 completed rides. This is not your lifetime total.', 'نعرض آخر 100 إقامة و100 رحلة مكتملة فقط. هذه ليست حصيلة حسابك الكاملة.', 'Affichage limité aux 100 derniers séjours et 100 derniers trajets terminés. Ce n’est pas le total historique.')}</p>}
      <form onSubmit={preview}>
        <label>{t('Test MSH per completed stay', 'MSH تجريبي لكل إقامة مكتملة', 'MSH de test par séjour terminé')}<input type="number" min="0" max="100" step="1" required value={stay} onChange={e => { setStay(e.target.value); setResult(null); setInvalid(false) }} /></label>
        <label>{t('Test MSH per completed ride', 'MSH تجريبي لكل رحلة مكتملة', 'MSH de test par trajet terminé')}<input type="number" min="0" max="100" step="1" required value={ride} onChange={e => { setRide(e.target.value); setResult(null); setInvalid(false) }} /></label>
        <p>{t('Use whole numbers from 0 to 100. Set 0 to exclude a service. At least one rate must be positive.', 'استخدم أعداداً صحيحة من 0 إلى 100. استخدم 0 لاستبعاد خدمة. يجب أن تكون إحدى القيم موجبة.', 'Utilisez des entiers de 0 à 100. Une valeur de 0 exclut le service. Au moins un taux doit être positif.')}</p>
        <button type="submit" disabled={busy}>{t('Calculate draft preview', 'حساب معاينة المسودة', 'Calculer le brouillon')}</button>
      </form>
      {invalid && <p role="alert">{t('Enter a valid earning rule.', 'أدخل قاعدة مكافآت صحيحة.', 'Saisissez une règle valide.')}</p>}
      {result && <div role="status" aria-live="polite"><p><strong>{result.tokens} {t('test MSH preview units', 'وحدة MSH تجريبية للمعاينة', 'unités MSH de test simulées')}</strong></p><p>{result.eligible} {t('eligible activities', 'أنشطة مؤهلة', 'activités admissibles')} · {result.held} {t('held for payment or refund review', 'معلقة لمراجعة الدفع أو الاسترداد', 'en attente de vérification du paiement ou remboursement')}</p></div>}
      <ul>{activity.entries.map(entry => <li key={entry.reference}><span dir="ltr">{entry.reference}</span> — {entry.eligibility === 'eligible' ? t('Eligible for preview', 'مؤهل للمعاينة', 'Admissible à la simulation') : entry.eligibility === 'refund' ? t('Held: refund', 'معلق: استرداد', 'En attente : remboursement') : t('Held: payment', 'معلق: دفع', 'En attente : paiement')}</li>)}</ul>
      {!activity.entries.length && <p>{t('No completed stays or rides found for this account.', 'لا توجد إقامات أو رحلات مكتملة لهذا الحساب.', 'Aucun séjour ou trajet terminé pour ce compte.')}</p>}
    </>}
    <p>{t('Nothing is awarded or redeemed. Rules are not saved or enabled. Existing loyalty points, payments and the 15% stays commission keep their current rules.', 'لا تُمنح أو تُستبدل أي مكافآت. القواعد غير محفوظة أو مفعلة. نقاط الولاء والمدفوعات وعمولة الإقامات 15٪ تبقى وفق قواعدها الحالية.', 'Aucune attribution ni utilisation de récompenses. Les règles ne sont ni enregistrées ni activées. Les points de fidélité, paiements et la commission de 15 % sur les séjours conservent leurs règles actuelles.')}</p>
  </section>
}
