import { useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { updateFoodMerchantSettings, type FoodMerchant } from '../../shared/api/platformApi'

const DAYS: Array<[number, string, string, string]> = [
  [6, 'السبت', 'Sat', 'Sam'],
  [0, 'الأحد', 'Sun', 'Dim'],
  [1, 'الاثنين', 'Mon', 'Lun'],
  [2, 'الثلاثاء', 'Tue', 'Mar'],
  [3, 'الأربعاء', 'Wed', 'Mer'],
  [4, 'الخميس', 'Thu', 'Jeu'],
  [5, 'الجمعة', 'Fri', 'Ven'],
]

// Opening hours + minimum order for one store (owner). Hours are optional: leaving them off means the
// store is always open (the "busy" switch still works). The server refuses immediate orders outside
// the hours and below the minimum.
export function MerchantHoursEditor({ merchant, lang, onSaved }: { merchant: FoodMerchant; lang: Lang; onSaved: (m: FoodMerchant) => void }) {
  const hours = merchant.openingHours
  const [enabled, setEnabled] = useState(Boolean(hours))
  const [days, setDays] = useState<number[]>(hours?.days ?? [0, 1, 2, 3, 4, 5, 6])
  const [open, setOpen] = useState(hours?.open ?? '09:00')
  const [close, setClose] = useState(hours?.close ?? '23:00')
  const [minOrder, setMinOrder] = useState(merchant.minOrderMinor ? String(merchant.minOrderMinor) : '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function save() {
    setBusy(true)
    setMessage('')
    try {
      const minValue = minOrder.trim() === '' ? null : Number(minOrder)
      const updated = await updateFoodMerchantSettings(merchant.id, {
        openingHours: enabled ? { days, open, close } : null,
        minOrderMinor: minValue,
      })
      onSaved(updated)
      setMessage(pick(lang, 'تم الحفظ', 'Saved', 'Enregistré'))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid #d6dbe6', borderRadius: 8 }}>
      <strong>{pick(lang, 'ساعات العمل والحد الأدنى للطلب', 'Opening hours & minimum order', 'Horaires et commande minimum')}</strong>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {pick(lang, 'تحديد ساعات عمل (بدونها المطعم مفتوح دائماً)', 'Set opening hours (otherwise always open)', 'Définir des horaires (sinon toujours ouvert)')}
      </label>
      {enabled ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {DAYS.map(([d, ar, en, fr]) => (
              <label key={d} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={days.includes(d)}
                  onChange={(e) => setDays((prev) => (e.target.checked ? [...prev, d] : prev.filter((x) => x !== d)))}
                />
                {pick(lang, ar, en, fr)}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>{pick(lang, 'يفتح', 'Opens', 'Ouvre')} <input type="time" value={open} onChange={(e) => setOpen(e.target.value)} /></label>
            <label>{pick(lang, 'يغلق', 'Closes', 'Ferme')} <input type="time" value={close} onChange={(e) => setClose(e.target.value)} /></label>
          </div>
          <small>{pick(lang, 'إذا كان الإغلاق بعد منتصف الليل (مثلاً 02:00) اكتبه كما هو.', 'If you close after midnight (e.g. 02:00) just enter it.', 'Si vous fermez après minuit (ex. 02:00), saisissez-le tel quel.')}</small>
        </>
      ) : null}
      <label>
        {pick(lang, 'الحد الأدنى للطلب (بالوحدة الصغرى، اتركه فارغاً لعدم التحديد)', 'Minimum order (minor units, empty = none)', 'Commande minimum (unités mineures, vide = aucune)')}{' '}
        <input type="number" min={0} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
      </label>
      <button type="button" disabled={busy || (enabled && days.length === 0)} onClick={() => void save()}>
        {busy ? '...' : pick(lang, 'حفظ', 'Save', 'Enregistrer')}
      </button>
      {message ? <small role="status">{message}</small> : null}
    </div>
  )
}
