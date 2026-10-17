import { useEffect, useState } from 'react'
import { markDriverArrived, markRiderNoShow, type PlatformRideRequest } from '../../shared/api/platformApi'

type Lang = 'ar' | 'en' | 'fr'

const text = {
  ar: {
    arrived: 'وصلت إلى نقطة الاستلام',
    hint: 'اضغط عند وصولك. سنُنبّه الراكب وتبدأ مهلة الانتظار.',
    waiting: 'بانتظار الراكب',
    left: 'المتبقي',
    noShow: 'الراكب لم يحضر — إنهاء الرحلة',
    noShowHint: 'انتهت مهلة الانتظار. عند الإنهاء تُحتسب رسوم عدم الحضور على الراكب.',
    busy: 'جارٍ التنفيذ...',
  },
  en: {
    arrived: "I've arrived at the pickup",
    hint: 'Tap when you are at the pickup point. The rider is notified and the wait starts.',
    waiting: 'Waiting for the rider',
    left: 'left',
    noShow: "Rider didn't show — end ride",
    noShowHint: 'The wait is over. Ending the ride charges the rider the no-show fee.',
    busy: 'Working...',
  },
  fr: {
    arrived: 'Je suis arrivé au point de prise en charge',
    hint: 'Appuyez une fois sur place. Le passager est prévenu et l’attente commence.',
    waiting: 'En attente du passager',
    left: 'restant',
    noShow: 'Passager absent — terminer la course',
    noShowHint: 'L’attente est terminée. En terminant, le passager paie les frais d’absence.',
    busy: 'En cours...',
  },
}

function format(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function PickupWaitPanel({ ride, lang, onRefresh }: { ride: PlatformRideRequest; lang: Lang; onRefresh: () => void }) {
  const t = text[lang]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const wait = ride.wait ?? null
  const endsMs = wait ? Date.parse(wait.waitEndsAt) : 0

  useEffect(() => {
    if (!wait) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [wait])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  const secondsLeft = wait ? Math.max(0, Math.ceil((endsMs - now) / 1000)) : 0
  const verified = Boolean(ride.metadata?.pickupVerifiedAt)
  if (verified) return null

  return (
    <div style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid #263651', borderRadius: 8 }}>
      {!wait ? (
        <>
          <small>{t.hint}</small>
          <button disabled={busy} onClick={() => void run(() => markDriverArrived(ride.id))}>
            {busy ? t.busy : t.arrived}
          </button>
        </>
      ) : secondsLeft > 0 ? (
        <strong>
          {t.waiting} · {format(secondsLeft)} {t.left}
        </strong>
      ) : (
        <>
          <small>{t.noShowHint}</small>
          <button disabled={busy} onClick={() => void run(() => markRiderNoShow(ride.id))}>
            {busy ? t.busy : t.noShow}
          </button>
        </>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
