import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { publicWebOrigin } from '../../shared/native/nativeShell'

// Shown to the guest on a paid + confirmed booking. The host scans it on arrival; the QR opens the
// host's check-in page for this booking (#/checkin/<bookingId>). It carries only the booking id --
// the server still only lets the listing's own host mark the check-in.
export function CheckinQrCard({ bookingId, lang }: { bookingId: string; lang: Lang }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    const target = `${publicWebOrigin()}/#/checkin/${bookingId}`
    QRCode.toDataURL(target, { margin: 1, width: 220 }).then((url) => { if (alive) setSrc(url) }).catch(() => { if (alive) setSrc('') })
    return () => { alive = false }
  }, [bookingId])
  if (!src) return null
  return (
    <section
      aria-label={pick(lang, 'رمز الوصول', 'Arrival QR code', "QR code d'arrivée")}
      style={{ background: '#0c1220', border: '1px solid #263651', borderRadius: 12, padding: 16, marginTop: 12, textAlign: 'center', color: '#eef1f8' }}
    >
      <strong style={{ display: 'block', marginBottom: 6 }}>{pick(lang, 'رمز الوصول إلى الإقامة', 'Your arrival QR code', "Votre QR code d'arrivée")}</strong>
      <p style={{ margin: '0 0 10px', opacity: 0.8 }}>
        {pick(lang, 'أرِ هذا الرمز للمضيف عند وصولك ليؤكد دخولك.', 'Show this code to the host when you arrive so they can confirm your check-in.', "Montrez ce code à l'hôte à votre arrivée pour confirmer votre enregistrement.")}
      </p>
      <img src={src} alt="QR" width={220} height={220} style={{ background: '#fff', borderRadius: 8, padding: 6 }} />
    </section>
  )
}
