import { useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { text } from '../../engines/language/languageEngine'
import { DIVISIONS } from '../../engines/navigation/divisions'
import type { DivisionId } from '../../engines/navigation/divisions'
import { navigate } from '../../app/routes'
import type { CSSVars } from '../../shared/theme/cssVars'

type Props = {
  lang: Lang
}

const DIVISION_PHOTOS: Record<DivisionId, string> = {
  stays: '/assets/divisions/daily-rental.webp',
  rentals: '/assets/divisions/monthly-rental.webp',
  buy: '/assets/divisions/buy-property.webp',
  cars: '/assets/divisions/cars.webp',
  marketplace: '/assets/divisions/marketplace.webp',
  'new-construction': '/assets/divisions/new-construction.webp',
  sell: '/assets/divisions/add-listing.webp',
  ride: '/assets/divisions/sr-ride.webp',
}

const DIVISION_ICONS: Record<DivisionId, string> = {
  stays: '⌂',
  rentals: '▣',
  buy: '⌁',
  cars: '⌘',
  marketplace: '▤',
  'new-construction': '⊗',
  sell: '⊕',
  ride: '✕',
}

const ABOUT_COPY = {
  ar: {
    eyebrow: 'SYBNB V6',
    title: 'منصة واحدة تحفظ وقتك وحقك داخل سوريا.',
    body: 'SYBNB تجمع البحث، الحجز، الدفع الآمن، الثقة، وخدمة ما بعد الحجز في تجربة واحدة واضحة للعميل والمضيف والإدارة.',
    missionTitle: 'المهمة',
    missionBody: 'تسهيل الإيجار، الشراء، المركبات، السوق، والخدمات اليومية بطريقة موثوقة وسريعة.',
    visionTitle: 'الرؤية',
    visionBody: 'أن تصبح SYBNB بوابة سوريا الرقمية الأولى للحجز والخدمات المحمية.',
    sloganTitle: 'الشعار',
    sloganBody: 'ابحث بثقة. احجز بأمان. تابع كل شيء من مكان واحد.',
    movieTitle: 'فيلم المنصة',
    movieBody: 'قصة قصيرة تشرح رسالة المنصة، لماذا نحمي الدفع، وكيف تتحرك رحلة العميل من البحث إلى التأكيد.',
    movieCta: 'شاهد الفيلم',
    moviePause: 'إيقاف الفيلم',
    adEyebrow: 'مساحة إعلانية',
    adTitle: 'اعرض إعلانك داخل SYBNB',
    adBody: 'بانر مميز للشركات، المشاريع العقارية، السيارات، والخدمات التي تريد الظهور أمام عملاء المنصة.',
    adCta: 'احجز مساحة إعلانية',
  },
  en: {
    eyebrow: 'SYBNB V6',
    title: 'One platform to protect your time and your rights in Syria.',
    body: 'SYBNB brings search, booking, safe payment, trust, and post-booking support into one clear experience for guests, hosts, and operations.',
    missionTitle: 'Mission',
    missionBody: 'Make rentals, buying, cars, marketplace, and daily services easier, faster, and more trusted.',
    visionTitle: 'Vision',
    visionBody: 'Become Syria’s first digital gateway for protected bookings and services.',
    sloganTitle: 'Slogan',
    sloganBody: 'Search with trust. Book safely. Track everything in one place.',
    movieTitle: 'Platform movie',
    movieBody: 'A short story showing the platform message, why protected payment matters, and how the client journey moves from search to confirmation.',
    movieCta: 'Watch movie',
    moviePause: 'Pause movie',
    adEyebrow: 'Advertising slot',
    adTitle: 'Promote your brand inside SYBNB',
    adBody: 'A premium banner for companies, property projects, cars, and services that want to reach platform clients.',
    adCta: 'Book advertising space',
  },
}

const AD_SPONSORS = [
  { image: DIVISION_PHOTOS.stays, ar: 'إقامة مميزة في دمشق', en: 'Featured stay in Damascus' },
  { image: DIVISION_PHOTOS.cars, ar: 'عروض سيارات موثوقة', en: 'Trusted car offers' },
  { image: DIVISION_PHOTOS.marketplace, ar: 'متاجر وخدمات محلية', en: 'Local shops and services' },
  { image: DIVISION_PHOTOS['new-construction'], ar: 'مشاريع عقارية جديدة', en: 'New property projects' },
  { image: DIVISION_PHOTOS.ride, ar: 'سير SR جاهز للتنقل', en: 'SR rides ready to move' },
]

export function LandingPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const about = ABOUT_COPY[lang]
  const movieSrc = isAr ? '/assets/videos/str-promo-ar.mp4' : '/assets/videos/str-promo-en.mp4'
  const heroVideoSrc = isAr ? '/assets/videos/hero-highlight-ar.mp4' : '/assets/videos/hero-highlight-en.mp4'
  const [moviePlaying, setMoviePlaying] = useState(false)
  const showAbout = () => document.getElementById('platform-about')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <main className="landing-page">
      <section className="landing-ad-marquee" aria-label={isAr ? 'إعلانات متحركة' : 'Moving advertising banner'}>
        <div className="ad-marquee-heading">
          <span>{isAr ? 'إعلانات مميزة' : 'Featured ads'}</span>
          <button
            type="button"
            onClick={() => {
              window.localStorage.setItem('sybnb_v6_sell_flow', 'advertising')
              navigate('/sell/account')
            }}
          >
            {isAr ? 'احجز إعلانك' : 'Book your ad'}
          </button>
        </div>
        <div className="ad-marquee-track" aria-hidden="true">
          {[...AD_SPONSORS, ...AD_SPONSORS].map((item, index) => (
            <article className="ad-marquee-card" key={`${item.en}-${index}`}>
              <img src={item.image} alt="" />
              <strong>{isAr ? item.ar : item.en}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <video
            key={heroVideoSrc}
            className="landing-hero-mark"
            src={heroVideoSrc}
            controls
            playsInline
            preload="metadata"
            aria-label={isAr ? 'فيديو تعريفي عن المنصة' : 'Platform introduction video'}
          />
          <h1>{isAr ? 'منصة سوريا الكاملة' : 'Syria Complete Platform'}</h1>
          <p>
            {isAr
              ? 'كل ما تحتاجه في مكان واحد - عقارات، سيارات، خدمات، وسير.'
              : 'Everything you need in one place: property, cars, services, and SR.'}
          </p>
          <div className="landing-actions">
            <button className="landing-primary" onClick={() => navigate('/search-preview')}>
              {isAr ? 'ابدأ الآن' : 'Start now'}
            </button>
            <button className="landing-secondary" onClick={showAbout}>
              {isAr ? 'تعرف علينا' : 'Know us'}
            </button>
          </div>
        </div>
        <div className="landing-hero-visual" aria-hidden="true">
          <img className="hero-photo hero-photo-back" src={DIVISION_PHOTOS.stays} alt="" />
          <img className="hero-photo hero-photo-front" src={DIVISION_PHOTOS.cars} alt="" />
        </div>
      </section>

      <section id="platform-about" className="landing-about" aria-label={about.eyebrow}>
        <div className="landing-about-copy">
          <span>{about.eyebrow}</span>
          <h2>{about.title}</h2>
          <p>{about.body}</p>
          <div className="landing-about-pillars">
            <article>
              <b>{about.missionTitle}</b>
              <p>{about.missionBody}</p>
            </article>
            <article>
              <b>{about.visionTitle}</b>
              <p>{about.visionBody}</p>
            </article>
            <article>
              <b>{about.sloganTitle}</b>
              <p>{about.sloganBody}</p>
            </article>
          </div>
        </div>
        <div className={`landing-about-movie ${moviePlaying ? 'playing' : ''}`}>
          <video
            key={movieSrc}
            className="about-movie-video"
            src={movieSrc}
            controls
            playsInline
            preload="metadata"
            onPlay={() => setMoviePlaying(true)}
            onPause={() => setMoviePlaying(false)}
            onEnded={() => setMoviePlaying(false)}
          />
          <div className="about-movie-caption">
            <b>{about.movieTitle}</b>
            <p>{about.movieBody}</p>
          </div>
        </div>
      </section>

      <section className="landing-ad-banner" aria-label={about.adEyebrow}>
        <div>
          <span>{about.adEyebrow}</span>
          <h2>{about.adTitle}</h2>
          <p>{about.adBody}</p>
        </div>
        <button
          className="landing-primary"
          onClick={() => {
            window.localStorage.setItem('sybnb_v6_sell_flow', 'advertising')
            navigate('/sell/account')
          }}
        >
          {about.adCta}
        </button>
      </section>

      <h2 className="landing-section-title">{isAr ? 'استكشف الفئات' : 'Explore categories'}</h2>
      <section className="division-grid" aria-label={isAr ? 'أقسام المنصة' : 'Platform divisions'}>
        {DIVISIONS.map((division, index) => {
          const disabled = division.status === 'soon'
          return (
            <article
              className={`division-card ${disabled ? 'disabled' : ''}`}
              key={division.id}
              style={{ '--accent': division.accent, '--delay': `${index * 80}ms` } as CSSVars}
            >
              <button
                className="division-card-hit"
                disabled={disabled}
                onClick={() => navigate(division.route)}
                aria-label={text(division.title, lang)}
              />
              <div className="division-media" aria-hidden="true">
                <img src={DIVISION_PHOTOS[division.id]} alt="" loading="lazy" />
              </div>
              <div className="division-card-content">
                <div className="division-title-row">
                  <span className="division-icon" aria-hidden="true">{DIVISION_ICONS[division.id]}</span>
                  <h2>{text(division.title, lang)}</h2>
                </div>
                <small>{lang === 'ar' ? division.title.en : division.title.ar}</small>
                <span className="division-open">{disabled ? (isAr ? 'قريباً' : 'Soon') : (isAr ? 'افتح' : 'Open')}</span>
              </div>
            </article>
          )
        })}
      </section>

    </main>
  )
}
