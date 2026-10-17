import { useState } from 'react'
import { contestRideFee, type PlatformRideRequest } from '../../shared/api/platformApi'

type Lang = 'ar' | 'en' | 'fr'

const text = {
  ar: {
    title: 'هل الرسوم غير عادلة؟',
    hint: 'اشرح لنا باختصار وسيراجع فريقنا الطلب.',
    placeholder: 'سبب الاعتراض',
    send: 'اعترض على الرسوم',
    sending: 'جارٍ الإرسال...',
    open: 'تم استلام اعتراضك وهو قيد المراجعة.',
    waived: 'تمت مراجعة اعتراضك وإلغاء الرسوم.',
    upheld: 'تمت مراجعة اعتراضك وبقيت الرسوم. تواصل مع الدعم لمزيد من التفاصيل.',
  },
  en: {
    title: 'Is this fee not fair?',
    hint: 'Tell us briefly what happened and our team will review it.',
    placeholder: 'Why are you contesting the fee?',
    send: 'Contest the fee',
    sending: 'Sending...',
    open: 'We received your request and it is being reviewed.',
    waived: 'We reviewed your request and removed the fee.',
    upheld: 'We reviewed your request and the fee stays. Contact support for details.',
  },
  fr: {
    title: 'Ces frais vous semblent injustes ?',
    hint: 'Expliquez brièvement ce qui s’est passé, notre équipe examinera la demande.',
    placeholder: 'Pourquoi contestez-vous les frais ?',
    send: 'Contester les frais',
    sending: 'Envoi...',
    open: 'Votre demande a été reçue et est en cours d’examen.',
    waived: 'Nous avons examiné votre demande et supprimé les frais.',
    upheld: 'Nous avons examiné votre demande et les frais sont maintenus. Contactez le support.',
  },
}

export function RideFeeContest({ ride, lang }: { ride: PlatformRideRequest; lang: Lang }) {
  const t = text[lang]
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const contest = (ride.metadata?.feeContest ?? null) as { status?: string } | null
  const hasFee = ride.status === 'CANCELLED' && typeof ride.cancellationFeeMinor === 'number' && ride.cancellationFeeMinor > 0
  const resolved = contest?.status === 'WAIVED' || contest?.status === 'UPHELD'
  if (!hasFee && !resolved) return null

  if (contest || sent) {
    const note = contest?.status === 'WAIVED' ? t.waived : contest?.status === 'UPHELD' ? t.upheld : t.open
    return <p role="status">{note}</p>
  }

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await contestRideFee(ride.id, reason.trim())
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid #263651', borderRadius: 8 }}>
      <strong>{t.title}</strong>
      <small>{t.hint}</small>
      <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t.placeholder} rows={3} maxLength={1000} />
      <button disabled={busy || reason.trim().length < 5} onClick={() => void submit()}>
        {busy ? t.sending : t.send}
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
