import { useEffect, useState, type CSSProperties } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import {
  createSavedPlace,
  createStripeSetupSession,
  deleteSavedCard,
  deleteSavedPlace,
  fetchMyProfile,
  fetchSavedCard,
  fetchSavedPlaces,
  updateMyDisplayName,
  type PlatformSavedPlace,
  type SavedCard,
} from '@platform/shared/api/platformApi'

type Props = { lang: Lang; onSignOut: () => void }

const card: CSSProperties = { border: '1px solid #ddd', borderRadius: 14, padding: 14, display: 'grid', gap: 8, background: '#fff' }
const btn: CSSProperties = { padding: '8px 14px', borderRadius: 999, border: '1px solid #111', background: '#fff', cursor: 'pointer' }
const warn: CSSProperties = { color: '#b00020', fontWeight: 700 }
const input: CSSProperties = { padding: 10, borderRadius: 10, border: '1px solid #bbb', font: 'inherit' }

export function ProfilePage({ lang, onSignOut }: Props) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(false)
  const [savedCard, setSavedCard] = useState<SavedCard | null>(null)
  const [places, setPlaces] = useState<PlatformSavedPlace[]>([])
  const [placeLabel, setPlaceLabel] = useState('')
  const [placeAddress, setPlaceAddress] = useState('')
  const [error, setError] = useState('')

  async function reload() {
    try {
      const { profile } = await fetchMyProfile()
      setEmail(profile.email || '')
      setName(profile.displayName || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    fetchSavedCard().then(setSavedCard).catch(() => {})
    fetchSavedPlaces().then(setPlaces).catch(() => {})
  }
  useEffect(() => {
    void reload()
  }, [])

  const cardBad = Boolean(savedCard?.expired)
  const cardSoon = Boolean(savedCard?.expiringSoon)

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} style={{ maxWidth: 520, margin: '24px auto', padding: '0 16px', display: 'grid', gap: 14 }}>
      <h1 style={{ margin: 0 }}>{pick(lang, 'حسابي', 'My profile', 'Mon profil')}</h1>
      {error && <div style={warn}>{error}</div>}

      <section style={card}>
        <strong>{pick(lang, 'المعلومات', 'Information', 'Informations')}</strong>
        <label>{pick(lang, 'الاسم', 'Name', 'Nom')}
          <input style={{ ...input, width: '100%', boxSizing: 'border-box' }} value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} />
        </label>
        <div dir="ltr">{email}</div>
        <button type="button" style={btn} onClick={() => void updateMyDisplayName(name.trim()).then(() => setSaved(true)).catch((e) => setError(e instanceof Error ? e.message : String(e)))}>
          {saved ? '✓ ' : ''}{pick(lang, 'حفظ', 'Save', 'Enregistrer')}
        </button>
      </section>

      <section style={card}>
        <strong>{pick(lang, 'الدفع', 'Payments', 'Paiements')}</strong>
        {savedCard ? (
          <>
            <span dir="ltr">{`${(savedCard.brand || 'card').toUpperCase()} ···· ${savedCard.last4 || '----'}${savedCard.expMonth && savedCard.expYear ? `  ·  ${String(savedCard.expMonth).padStart(2, '0')}/${savedCard.expYear}` : ''}`}</span>
            {cardBad && <span style={warn}>{pick(lang, 'انتهت صلاحية البطاقة. أضف بطاقة جديدة لمتابعة الطلب.', 'This card has expired. Add a new card to keep booking rides.', 'Cette carte a expiré. Ajoutez une nouvelle carte pour continuer à réserver.')}</span>}
            {!cardBad && cardSoon && <span style={warn}>{pick(lang, 'ستنتهي صلاحية البطاقة قريباً.', 'This card expires soon.', 'Cette carte expire bientôt.')}</span>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={btn} onClick={() => void createStripeSetupSession().then(({ url }) => { window.location.href = url }).catch((e) => setError(e instanceof Error ? e.message : String(e)))}>
                {pick(lang, 'استبدال البطاقة', 'Replace card', 'Remplacer la carte')}
              </button>
              <button type="button" style={btn} onClick={() => void deleteSavedCard().then(() => setSavedCard(null)).catch((e) => setError(e instanceof Error ? e.message : String(e)))}>
                {pick(lang, 'إزالة', 'Remove', 'Retirer')}
              </button>
            </div>
          </>
        ) : (
          <>
            <span>{pick(lang, 'لا توجد بطاقة محفوظة. الدفع بالبطاقة فقط، لا نقد.', 'No card saved. Card only, no cash.', 'Aucune carte enregistrée. Carte seulement, pas d’espèces.')}</span>
            <button type="button" style={btn} onClick={() => void createStripeSetupSession().then(({ url }) => { window.location.href = url }).catch((e) => setError(e instanceof Error ? e.message : String(e)))}>
              {pick(lang, 'إضافة بطاقة', 'Add card', 'Ajouter une carte')}
            </button>
          </>
        )}
      </section>

      <section style={card}>
        <strong>{pick(lang, 'الأماكن المحفوظة', 'Saved places', 'Lieux enregistrés')}</strong>
        {places.map((place) => (
          <div key={place.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span><strong>{place.label}</strong> · {place.address}</span>
            <button type="button" style={btn} onClick={() => void deleteSavedPlace(place.id).then(reload).catch(() => {})}>×</button>
          </div>
        ))}
        <input style={input} placeholder={pick(lang, 'الاسم (المنزل، العمل…)', 'Label (Home, Work…)', 'Nom (Maison, Travail…)')} value={placeLabel} onChange={(e) => setPlaceLabel(e.target.value)} />
        <input style={input} placeholder={pick(lang, 'العنوان', 'Address', 'Adresse')} value={placeAddress} onChange={(e) => setPlaceAddress(e.target.value)} />
        <button
          type="button"
          style={btn}
          disabled={!placeLabel.trim() || !placeAddress.trim()}
          onClick={() => void createSavedPlace({ label: placeLabel.trim(), address: placeAddress.trim() }).then(() => { setPlaceLabel(''); setPlaceAddress(''); return reload() }).catch((e) => setError(e instanceof Error ? e.message : String(e)))}
        >
          {pick(lang, 'إضافة مكان', 'Add place', 'Ajouter un lieu')}
        </button>
      </section>

      <button type="button" style={{ ...btn, borderColor: '#b00020', color: '#b00020' }} onClick={onSignOut}>
        {pick(lang, 'تسجيل الخروج', 'Log out', 'Se déconnecter')}
      </button>
    </main>
  )
}
