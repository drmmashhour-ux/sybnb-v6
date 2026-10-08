import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchMyHostProfile, saveHostProfile, uploadHostPhoto, type HostProfile } from '../../shared/api/platformApi'

// Host profile -- shown right after "Start hosting" and any time from the host dashboard.
// Airbnb's idea (guests book people, not just places) in SYBNB's own look: photo, a short
// "About me", languages, and city. Guests see it on the host's listings.

type Props = { lang: Lang }

export const HOST_PROFILE_NEXT_KEY = 'sybnb.v6.hostProfileNext'

const LANGUAGE_OPTIONS: Array<{ code: string; ar: string; en: string }> = [
  { code: 'ar', ar: 'العربية', en: 'Arabic' },
  { code: 'en', ar: 'الإنجليزية', en: 'English' },
  { code: 'fr', ar: 'الفرنسية', en: 'French' },
  { code: 'ku', ar: 'الكردية', en: 'Kurdish' },
  { code: 'tr', ar: 'التركية', en: 'Turkish' },
  { code: 'de', ar: 'الألمانية', en: 'German' },
  { code: 'es', ar: 'الإسبانية', en: 'Spanish' },
  { code: 'ru', ar: 'الروسية', en: 'Russian' },
  { code: 'fa', ar: 'الفارسية', en: 'Persian' },
  { code: 'hy', ar: 'الأرمنية', en: 'Armenian' },
  { code: 'it', ar: 'الإيطالية', en: 'Italian' },
  { code: 'sv', ar: 'السويدية', en: 'Swedish' },
]

const copy = {
  ar: {
    title: 'ملفك كمضيف',
    intro: 'الضيوف يحجزون عند أشخاص، لا عند عناوين فقط. عرّف بنفسك ليشعروا بالثقة قبل الحجز.',
    addPhoto: 'أضف صورة',
    changePhoto: 'تغيير الصورة',
    photoHint: 'صورة واضحة لوجهك، بدون شعارات أو نصوص.',
    about: 'نبذة عنك',
    aboutPlaceholder: 'مثال: أهلاً، أنا محمد من اللاذقية. أحب استقبال الضيوف وأعرف أجمل الأماكن قرب البحر…',
    city: 'أين تعيش؟',
    cityPlaceholder: 'المدينة',
    languages: 'اللغات التي تتحدثها',
    save: 'حفظ والمتابعة',
    skip: 'لاحقاً',
    saved: 'تم حفظ ملفك.',
    uploading: 'جارٍ رفع الصورة…',
    loadError: 'تعذّر تحميل ملفك. حاول مرة أخرى.',
    preview: 'هكذا يراك الضيوف',
    hostedBy: 'المضيف',
    memberSince: (y: number) => `على SYBNB منذ ${y}`,
    speaks: 'يتحدث',
  },
  en: {
    title: 'Your host profile',
    intro: 'Guests book people, not just places. Introduce yourself so they feel confident before booking.',
    addPhoto: 'Add a photo',
    changePhoto: 'Change photo',
    photoHint: 'A clear photo of your face, no logos or text.',
    about: 'About you',
    aboutPlaceholder: "Example: Hi, I'm Mohamed from Latakia. I love welcoming guests and know the best spots by the sea…",
    city: 'Where do you live?',
    cityPlaceholder: 'City',
    languages: 'Languages you speak',
    save: 'Save and continue',
    skip: 'Later',
    saved: 'Your profile is saved.',
    uploading: 'Uploading photo…',
    loadError: 'Could not load your profile. Please try again.',
    preview: 'How guests see you',
    hostedBy: 'Hosted by',
    memberSince: (y: number) => `On SYBNB since ${y}`,
    speaks: 'Speaks',
  },
}

export function HostProfilePage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const fileRef = useRef<HTMLInputElement>(null)
  const [profile, setProfile] = useState<HostProfile | null>(null)
  const [about, setAbout] = useState('')
  const [city, setCity] = useState('')
  const [languages, setLanguages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    let alive = true
    fetchMyHostProfile()
      .then((p) => {
        if (!alive) return
        setProfile(p)
        setAbout(p.about || '')
        setCity(p.city || '')
        setLanguages(p.languages.length ? p.languages : [lang])
      })
      .catch(() => {
        if (alive) {
          setMessage(t.loadError)
          setIsError(true)
        }
      })
    return () => {
      alive = false
    }
  }, [lang, t.loadError])

  function nextPath() {
    try {
      const next = sessionStorage.getItem(HOST_PROFILE_NEXT_KEY)
      sessionStorage.removeItem(HOST_PROFILE_NEXT_KEY)
      if (next && next.startsWith('/') && next !== '/host/profile') return next
    } catch {
      /* ignore */
    }
    return '/host/stays'
  }

  function toggleLanguage(code: string) {
    setLanguages((current) => (current.includes(code) ? current.filter((c) => c !== code) : [...current, code]))
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setMessage('')
    try {
      setProfile(await uploadHostPhoto(file))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t.loadError)
      setIsError(true)
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    setBusy(true)
    setMessage('')
    try {
      setProfile(await saveHostProfile({ about, city, languages }))
      setMessage(t.saved)
      setIsError(false)
      window.location.hash = nextPath()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t.loadError)
      setIsError(true)
    } finally {
      setBusy(false)
    }
  }

  const name = profile?.displayName || ''
  const languageLabel = (code: string) => {
    const option = LANGUAGE_OPTIONS.find((o) => o.code === code)
    return option ? (isAr ? option.ar : option.en) : code
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.intro}>{t.intro}</p>

        <div style={styles.photoRow}>
          <button type="button" style={styles.photo} onClick={() => fileRef.current?.click()} aria-label={profile?.photoUrl ? t.changePhoto : t.addPhoto}>
            {profile?.photoUrl ? <img src={profile.photoUrl} alt="" style={styles.photoImg} /> : <span style={styles.initial}>{name.slice(0, 1).toUpperCase() || '+'}</span>}
          </button>
          <div style={styles.photoText}>
            <button type="button" style={styles.linkButton} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? t.uploading : profile?.photoUrl ? t.changePhoto : t.addPhoto}
            </button>
            <small style={styles.hint}>{t.photoHint}</small>
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
        </div>

        <label style={styles.label}>
          {t.about}
          <textarea style={styles.textarea} value={about} maxLength={1000} onChange={(e) => setAbout(e.target.value)} placeholder={t.aboutPlaceholder} rows={5} />
          <small style={styles.counter}>{about.length}/1000</small>
        </label>

        <label style={styles.label}>
          {t.city}
          <input style={styles.input} value={city} maxLength={80} onChange={(e) => setCity(e.target.value)} placeholder={t.cityPlaceholder} />
        </label>

        <div style={styles.label}>
          {t.languages}
          <div style={styles.chips}>
            {LANGUAGE_OPTIONS.map((option) => {
              const on = languages.includes(option.code)
              return (
                <button key={option.code} type="button" onClick={() => toggleLanguage(option.code)} style={on ? styles.chipOn : styles.chip} aria-pressed={on}>
                  {isAr ? option.ar : option.en}
                </button>
              )
            })}
          </div>
        </div>

        <div style={styles.previewBox}>
          <small style={styles.previewLabel}>{t.preview}</small>
          <div style={styles.previewRow}>
            <div style={styles.previewAvatar}>
              {profile?.photoUrl ? <img src={profile.photoUrl} alt="" style={styles.photoImg} /> : name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <strong>{t.hostedBy} {name}</strong>
              <div style={styles.previewMeta}>
                {[city, profile?.memberSince ? t.memberSince(profile.memberSince) : '', languages.length ? `${t.speaks} ${languages.map(languageLabel).join('، ')}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </div>
          {about ? <p style={styles.previewAbout}>{about}</p> : null}
        </div>

        {message ? <strong role="status" style={isError ? styles.error : styles.success}>{message}</strong> : null}

        <button style={{ ...styles.primary, opacity: busy ? 0.7 : 1 }} onClick={() => void save()} disabled={busy}>
          {busy ? '…' : t.save}
        </button>
        <button style={styles.skip} onClick={() => (window.location.hash = nextPath())}>
          {t.skip}
        </button>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: 'calc(100vh - 160px)', background: '#08090e', color: '#fff', padding: '24px 16px 90px', display: 'grid', alignContent: 'start', justifyItems: 'center' },
  card: { width: '100%', maxWidth: 620, border: '1px solid #232638', borderRadius: 16, background: '#0e0f16', padding: 28, display: 'grid', gap: 20 },
  title: { margin: 0, fontSize: 26, fontWeight: 900 },
  intro: { margin: 0, color: '#aab3c8', lineHeight: 1.7 },
  photoRow: { display: 'flex', alignItems: 'center', gap: 18 },
  photo: { width: 112, height: 112, borderRadius: 999, border: '2px dashed #3a4260', background: '#141726', color: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden', cursor: 'pointer', padding: 0, flexShrink: 0 },
  photoImg: { width: '100%', height: '100%', objectFit: 'cover' },
  initial: { fontSize: 40, fontWeight: 900, color: '#9fb0ff' },
  photoText: { display: 'grid', gap: 6 },
  linkButton: { justifySelf: 'start', border: 0, background: 'transparent', color: '#9fb0ff', fontWeight: 800, textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 16 },
  hint: { color: '#7f879a' },
  label: { display: 'grid', gap: 8, fontWeight: 800, color: '#dce3ff' },
  textarea: { border: '1px solid #2c3046', borderRadius: 10, background: '#111118', color: '#fff', padding: 14, fontSize: 15, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit' },
  counter: { justifySelf: 'end', color: '#7f879a', fontWeight: 500 },
  input: { minHeight: 52, border: '1px solid #2c3046', borderRadius: 10, background: '#111118', color: '#fff', padding: '0 14px', fontSize: 15 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  chip: { border: '1px solid #2c3046', borderRadius: 999, background: '#111118', color: '#cfd6ea', padding: '8px 14px', fontWeight: 700, cursor: 'pointer' },
  chipOn: { border: '1px solid #5268ff', borderRadius: 999, background: 'rgba(82,104,255,.18)', color: '#fff', padding: '8px 14px', fontWeight: 800, cursor: 'pointer' },
  previewBox: { border: '1px solid rgba(213,169,21,.35)', borderRadius: 12, background: 'rgba(213,169,21,.05)', padding: 16, display: 'grid', gap: 10 },
  previewLabel: { color: '#d5a915', fontWeight: 800 },
  previewRow: { display: 'flex', gap: 12, alignItems: 'center' },
  previewAvatar: { width: 48, height: 48, borderRadius: 999, background: '#1d2332', display: 'grid', placeItems: 'center', overflow: 'hidden', fontWeight: 900, flexShrink: 0 },
  previewMeta: { color: '#9aa6ba', fontSize: 13, marginTop: 2 },
  previewAbout: { margin: 0, color: '#cfd6ea', lineHeight: 1.6, whiteSpace: 'pre-wrap' },
  primary: { minHeight: 54, border: 0, borderRadius: 10, background: '#5268ff', color: '#fff', fontWeight: 900, fontSize: 16, cursor: 'pointer' },
  skip: { justifySelf: 'center', border: 0, background: 'transparent', color: '#9fb0ff', fontWeight: 800, textDecoration: 'underline', cursor: 'pointer' },
  success: { color: '#20d29b' },
  error: { color: '#ff8f9f' },
}
