import { useEffect, useState } from 'react'
import type { PlatformRideRequest } from '../../shared/api/platformApi'

type Lang = 'ar' | 'en' | 'fr'

const text = {
  ar: {
    arrived: 'وصل السائق! تفضّل بالخروج الآن.',
    left: 'مهلة الانتظار المتبقية',
    warn: 'إذا لم تحضر خلال المهلة سيغادر السائق ولن يُسترد المبلغ.',
    over: 'انتهت مهلة الانتظار. قد يغادر السائق وتُحتسب رسوم عدم الحضور.',
  },
  en: {
    arrived: 'Your driver has arrived. Please come out now.',
    left: 'Waiting time left',
    warn: 'If you do not show up in time the driver will leave and the fare is not refunded.',
    over: 'The waiting time is over. The driver may leave and the no-show fee applies.',
  },
  fr: {
    arrived: 'Votre chauffeur est arrivé. Merci de sortir maintenant.',
    left: 'Temps d’attente restant',
    warn: 'Si vous n’arrivez pas à temps, le chauffeur partira et la course n’est pas remboursée.',
    over: 'Le temps d’attente est écoulé. Le chauffeur peut partir et les frais d’absence s’appliquent.',
  },
}

function format(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function RiderArrivalBanner({ ride, lang }: { ride: PlatformRideRequest; lang: Lang }) {
  const t = text[lang]
  const wait = ride.wait ?? null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!wait) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [wait])
  if (!wait || ride.status !== 'DRIVER_ARRIVING') return null
  const secondsLeft = Math.max(0, Math.ceil((Date.parse(wait.waitEndsAt) - now) / 1000))
  return (
    <div
      role="status"
      style={{ display: 'grid', gap: 6, padding: 12, borderRadius: 8, border: '2px solid #e5b80b', textAlign: 'center' }}
    >
      <strong>{t.arrived}</strong>
      {secondsLeft > 0 ? (
        <>
          <span>
            {t.left}: <strong>{format(secondsLeft)}</strong>
          </span>
          <small>{t.warn}</small>
        </>
      ) : (
        <small>{t.over}</small>
      )}
    </div>
  )
}
