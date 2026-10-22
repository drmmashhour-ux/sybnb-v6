import { pick, type Lang } from '../../engines/language/languageEngine'

// One photo the host picked in the listing wizard. `preview` is a local object URL so the host sees
// the real image immediately; `url` is the stored file once the upload finishes.
export type WizardPhoto = {
  key: string
  name: string
  preview: string
  url?: string
  status: 'uploading' | 'ready' | 'error'
  error?: string
}

type Props = {
  lang: Lang
  photos: WizardPhoto[]
  onAddFiles: (files: FileList | null) => void
  onRemove: (key: string) => void
  onMove: (key: string, delta: number) => void
  onMakeCover: (key: string) => void
  title: string
  cta: string
  help: string
  emptyText: string
}

const MAX_PHOTOS = 20 // = server limit on media items per listing

export function ListingPhotoManager({ lang, photos, onAddFiles, onRemove, onMove, onMakeCover, title, cta, help, emptyText }: Props) {
  const full = photos.length >= MAX_PHOTOS
  return (
    <div className="payment-proof-upload listing-photo-manager" data-testid="wizard-photo-manager">
      <div className="payment-proof-upload-header">
        <strong>{title}</strong>
        <p>{help}</p>
      </div>
      {!full && (
        <label className="payment-proof-dropzone">
          <input
            accept=".png,.jpg,.jpeg,image/png,image/jpeg"
            data-testid="wizard-photo-input"
            multiple
            type="file"
            onChange={(event) => {
              onAddFiles(event.target.files)
              event.target.value = ''
            }}
          />
          <span>{cta}</span>
          <em>PNG · JPG · {pick(lang, `حتى ${MAX_PHOTOS} صورة`, `up to ${MAX_PHOTOS} photos`, `jusqu’à ${MAX_PHOTOS} photos`)}</em>
        </label>
      )}
      {photos.length ? (
        <>
          <p className="listing-photo-hint">
            {pick(
              lang,
              'الصورة الأولى هي صورة الغلاف التي تظهر في نتائج البحث. يمكنك الحذف أو تغيير الترتيب قبل الإرسال.',
              'The first photo is the cover guests see in search results. You can remove or reorder photos before submitting.',
              'La première photo est la couverture visible dans les résultats. Vous pouvez supprimer ou réordonner les photos avant l’envoi.',
            )}
          </p>
          <ul className="listing-photo-grid">
            {photos.map((photo, index) => (
              <li key={photo.key} className={`listing-photo-tile ${photo.status}`} data-testid="wizard-photo-tile">
                <img alt={photo.name} src={photo.preview} />
                {index === 0 && <span className="listing-photo-cover">{pick(lang, 'الغلاف', 'Cover', 'Couverture')}</span>}
                {photo.status === 'uploading' && <span className="listing-photo-state">{pick(lang, 'جار الرفع…', 'Uploading…', 'Téléversement…')}</span>}
                {photo.status === 'error' && <span className="listing-photo-state error">{photo.error || pick(lang, 'تعذر الرفع', 'Upload failed', 'Échec')}</span>}
                <div className="listing-photo-actions">
                  <button
                    type="button"
                    aria-label={pick(lang, 'تحريك للأمام', 'Move earlier', 'Avancer')}
                    disabled={index === 0}
                    onClick={() => onMove(photo.key, -1)}
                  >
                    {lang === 'ar' ? '→' : '←'}
                  </button>
                  {index !== 0 && (
                    <button type="button" data-testid="wizard-photo-cover" onClick={() => onMakeCover(photo.key)}>
                      ★ {pick(lang, 'غلاف', 'Cover', 'Couverture')}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={pick(lang, 'تحريك للخلف', 'Move later', 'Reculer')}
                    disabled={index === photos.length - 1}
                    onClick={() => onMove(photo.key, 1)}
                  >
                    {lang === 'ar' ? '←' : '→'}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    data-testid="wizard-photo-remove"
                    aria-label={pick(lang, 'حذف الصورة', 'Remove photo', 'Supprimer la photo')}
                    onClick={() => onRemove(photo.key)}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="listing-photo-empty">{emptyText}</p>
      )}
    </div>
  )
}

// What a guest will see in search: cover photo, title, place and price. Shown on the review step so
// the host checks the listing before sending it.
export function ListingPreviewCard({
  lang,
  photos,
  title,
  place,
  priceLabel,
  onEditPhotos,
  onEditDetails,
}: {
  lang: Lang
  photos: WizardPhoto[]
  title: string
  place: string
  priceLabel: string
  onEditPhotos: () => void
  onEditDetails: () => void
}) {
  const cover = photos[0]
  return (
    <div className="listing-preview-card" data-testid="wizard-preview-card">
      <p className="listing-preview-label">{pick(lang, 'هكذا سيظهر إعلانك للضيوف', 'How guests will see your listing', 'Aperçu de votre annonce pour les voyageurs')}</p>
      <div className="listing-preview-body">
        <div className="listing-preview-cover">
          {cover ? <img alt={title} src={cover.preview} /> : <span>{pick(lang, 'لا توجد صور بعد', 'No photos yet', 'Pas encore de photos')}</span>}
          {photos.length > 1 && <em>1 / {photos.length}</em>}
        </div>
        <div className="listing-preview-text">
          <strong>{title || pick(lang, 'بدون عنوان', 'Untitled', 'Sans titre')}</strong>
          <span>{place}</span>
          <b>{priceLabel}</b>
        </div>
      </div>
      {photos.length > 1 && (
        <div className="listing-preview-strip">
          {photos.slice(1, 8).map((photo) => (
            <img key={photo.key} alt={photo.name} src={photo.preview} />
          ))}
        </div>
      )}
      <div className="listing-preview-edit">
        <button type="button" className="seller-secondary-button" onClick={onEditPhotos}>
          {pick(lang, 'تعديل الصور', 'Edit photos', 'Modifier les photos')}
        </button>
        <button type="button" className="seller-secondary-button" onClick={onEditDetails}>
          {pick(lang, 'تعديل البيانات', 'Edit details', 'Modifier les informations')}
        </button>
      </div>
    </div>
  )
}
