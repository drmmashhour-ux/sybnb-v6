import { useEffect, useState } from 'react'
import { getLateCancelStrikes, type LateCancelStrikes } from '../../shared/api/platformApi'

type Lang = 'ar' | 'en' | 'fr'

// Warning shown to a rider or driver who already has late-cancel strikes. Silent when there are none.
export function LateCancelNotice({ role, lang }: { role: 'RIDER' | 'DRIVER'; lang: Lang }) {
  const [s, setS] = useState<LateCancelStrikes | null>(null)
  useEffect(() => {
    let alive = true
    getLateCancelStrikes(role).then((r) => alive && setS(r)).catch(() => {})
    return () => { alive = false }
  }, [role])
  if (!s || s.count < 1) return null
  const who = role === 'RIDER'
  const fee = `$${s.nextFeeMinor}`
  const msg = s.blocked
    ? {
        ar: who ? 'حسابك موقوف مؤقتاً عن طلب الرحلات بسبب تكرار الإلغاء المتأخر. تواصل مع الدعم.' : 'حسابك موقوف مؤقتاً عن قبول الرحلات بسبب تكرار الإلغاء المتأخر. تواصل مع الدعم.',
        en: who ? 'Your account is temporarily blocked from requesting rides because of repeated late cancellations. Contact support.' : 'Your account is temporarily blocked from accepting rides because of repeated late cancellations. Contact support.',
        fr: who ? 'Votre compte est temporairement bloqué pour les courses (annulations tardives répétées). Contactez le support.' : 'Votre compte est temporairement bloqué pour accepter des courses (annulations tardives répétées). Contactez le support.',
      }
    : {
        ar: `لديك ${s.count} من ${s.blockAt} إلغاءات متأخرة خلال ${s.windowDays} يوماً. الإلغاء المتأخر التالي: ${fee}، وعند ${s.blockAt} يُوقف الحساب.`,
        en: `You have ${s.count} of ${s.blockAt} late cancellations in ${s.windowDays} days. The next one costs ${fee}, and at ${s.blockAt} your account is blocked.`,
        fr: `Vous avez ${s.count} annulation(s) tardive(s) sur ${s.blockAt} en ${s.windowDays} jours. La prochaine coûte ${fee}, et à ${s.blockAt} votre compte est bloqué.`,
      }
  return (
    <div role="alert" dir={lang === 'ar' ? 'rtl' : 'ltr'} style={{ border: '1.5px solid #b45309', background: 'rgba(180,83,9,0.08)', borderRadius: 10, padding: 10, margin: '8px 0', fontWeight: 600 }}>
      ⚠️ {msg[lang]}
    </div>
  )
}
