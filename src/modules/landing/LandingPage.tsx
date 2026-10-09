import { useEffect, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { pick, text } from '../../engines/language/languageEngine'
import { DIVISIONS } from '../../engines/navigation/divisions'
import type { DivisionId } from '../../engines/navigation/divisions'
import { navigate } from '../../app/routes'
import type { CSSVars } from '../../shared/theme/cssVars'
import { fetchActiveAdvertising } from '../../shared/api/platformApi'
import type { ActiveAd } from '../../shared/api/platformApi'
import { listingDisplayTitle } from '../../shared/listing/displayTitle'
import { HeroSearch } from './HeroSearch'

const BANNER_KIND_PRIORITY = ['desktopBanner', 'mainBanner', 'tabletBanner', 'phoneBanner']

function adBannerUrl(ad: ActiveAd) {
  for (const kind of BANNER_KIND_PRIORITY) {
    const match = ad.media.find((item) => item.kind === kind)
    if (match) return match.url
  }
  return ad.media[0]?.url
}

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

// Landing card titles in all three languages. DIVISIONS (engines/navigation/divisions.ts) only
// carries ar/en, so French previously fell back to English on every card. "SR" is the ride service
// (سير, "SR Ride" in src/modules/sr); it is named as a service here rather than a bare "SR".
const DIVISION_TITLES: Record<DivisionId, { ar: string; en: string; fr: string }> = {
  stays: { ar: 'الإيجار اليومي', en: 'Daily Stays', fr: 'Séjours courte durée' },
  rentals: { ar: 'الإيجار الشهري', en: 'Monthly Rentals', fr: 'Location au mois' },
  buy: { ar: 'شراء عقار', en: 'Buy Property', fr: 'Achat immobilier' },
  cars: { ar: 'المركبات', en: 'Cars', fr: 'Véhicules' },
  marketplace: { ar: 'السوق', en: 'Marketplace', fr: 'Marché' },
  'new-construction': { ar: 'مشاريع جديدة', en: 'New Construction', fr: 'Projets neufs' },
  sell: { ar: 'أضف إعلانك', en: 'Add a Listing', fr: 'Publier une annonce' },
  ride: { ar: 'رحلات سير', en: 'SR Rides', fr: 'Trajets SR' },
}

// Host/seller entry: the "Add listing" card opens the public host landing page (/host/why), which
// explains fees/payouts and routes stays & rentals hosts into the /host flow and property sellers
// into /sell. Every other card keeps its division route.
function divisionRoute(id: DivisionId, route: string) {
  return id === 'sell' ? '/host/why' : route
}

function divisionTitle(id: DivisionId, fallback: { ar: string; en: string }, lang: Lang) {
  const titles = DIVISION_TITLES[id]
  return titles ? pick(lang, titles.ar, titles.en, titles.fr) : text(fallback, lang)
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
  fr: {
    eyebrow: 'SYBNB V6',
    title: 'Une seule plateforme pour protéger votre temps et vos droits en Syrie.',
    body: 'SYBNB réunit la recherche, la réservation, le paiement sécurisé, la confiance et le soutien après réservation dans une expérience claire pour les voyageurs, les hôtes et l’équipe d’exploitation.',
    missionTitle: 'Mission',
    missionBody: 'Rendre la location, l’achat, les véhicules, le marché et les services du quotidien plus simples, plus rapides et plus fiables.',
    visionTitle: 'Vision',
    visionBody: 'Devenir la première porte d’entrée numérique de la Syrie pour les réservations et services protégés.',
    sloganTitle: 'Slogan',
    sloganBody: 'Cherchez en confiance. Réservez en sécurité. Suivez tout au même endroit.',
    movieTitle: 'Film de la plateforme',
    movieBody: 'Une courte histoire qui présente la mission de la plateforme, l’importance du paiement protégé et le parcours du client, de la recherche à la confirmation.',
    movieCta: 'Voir le film',
    moviePause: 'Mettre le film en pause',
    adEyebrow: 'Espace publicitaire',
    adTitle: 'Faites la promotion de votre marque sur SYBNB',
    adBody: 'Une bannière premium pour les entreprises, projets immobiliers, véhicules et services qui veulent rejoindre la clientèle de la plateforme.',
    adCta: 'Réserver un espace publicitaire',
  },
}

export function LandingPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const about = ABOUT_COPY[lang]
  const movieSrc = isAr ? '/assets/videos/str-promo-ar.mp4' : '/assets/videos/str-promo-en.mp4'
  const [moviePlaying, setMoviePlaying] = useState(false)
  const activeCount = DIVISIONS.filter((division) => division.status === 'active').length
  const showAbout = () => document.getElementById('platform-about')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // Real, admin-approved ad campaigns only -- no fake/hardcoded sponsor cards (see the removed
  // "Featured ads" marquee note below). Renders nothing when there are zero approved ads instead
  // of a placeholder, matching CAPSULE_RULES.noFakeTrustSignal.
  const [activeAds, setActiveAds] = useState<ActiveAd[]>([])
  useEffect(() => {
    let cancelled = false
    fetchActiveAdvertising()
      .then((result) => {
        if (!cancelled) setActiveAds(result.ads)
      })
      .catch(() => {
        // No ads to show is a normal, silent outcome -- never block the landing page on this.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="landing-page">
      {/* A real bug caught by an independent re-audit: this used to be a "Featured ads" marquee
          of hardcoded division-generic cards with no real advertiser/listing behind any of them,
          right next to a live "Book your ad" CTA that implied visitors could buy into one of
          these exact slots. Removed rather than left as fabricated sponsor content --
          `landing-ad-banner` below is the real, honest equivalent: same "book advertising" CTA,
          no fake sponsor cards. CAPSULE_RULES.noFakeTrustSignal. */}

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-hero-mark" aria-hidden="true">×</span>
          <h1>{pick(lang, 'منصة سوريا الكاملة', 'Syria Complete Platform', 'La plateforme complète de la Syrie')}</h1>
          <p>
            {pick(
              lang,
              'كل ما تحتاجه في مكان واحد: عقارات، سيارات، خدمات، ورحلات سير.',
              'Everything you need in one place: property, cars, services, and SR Rides.',
              'Tout ce dont vous avez besoin au même endroit : immobilier, véhicules, services et Trajets SR.',
            )}
          </p>
          <HeroSearch lang={lang} />
          <button
            onClick={showAbout}
            style={{ background: 'transparent', border: 0, color: '#9fb0ff', fontWeight: 800, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
          >
            {pick(lang, 'تعرف على SYBNB', 'About SYBNB', 'À propos de SYBNB')}
          </button>
        </div>
        <div className="landing-hero-visual" aria-hidden="true">
          <img className="hero-photo hero-photo-back" src={DIVISION_PHOTOS.stays} alt="" />
          <img className="hero-photo hero-photo-front" src={DIVISION_PHOTOS.cars} alt="" />
        </div>
      </section>

      <h2 className="landing-section-title">{pick(lang, 'استكشف الفئات', 'Explore categories', 'Explorer les catégories')}</h2>
      <section className="division-grid" aria-label={pick(lang, 'أقسام المنصة', 'Platform divisions', 'Sections de la plateforme')}>
        {DIVISIONS.map((division, index) => {
          const disabled = division.status === 'soon'
          const title = divisionTitle(division.id, division.title, lang)
          return (
            <article
              className={`division-card ${disabled ? 'disabled' : ''}`}
              key={division.id}
              style={{ '--accent': division.accent, '--delay': `${index * 80}ms` } as CSSVars}
            >
              <button
                className="division-card-hit"
                disabled={disabled}
                onClick={() => navigate(divisionRoute(division.id, division.route))}
                aria-label={title}
              />
              <div className="division-media" aria-hidden="true">
                <img src={DIVISION_PHOTOS[division.id]} alt="" loading="lazy" />
              </div>
              <div className="division-card-content">
                <div className="division-title-row">
                  <span className="division-icon" aria-hidden="true">{DIVISION_ICONS[division.id]}</span>
                  <h2>{title}</h2>
                </div>
                <span className="division-open">{disabled ? (pick(lang, 'قريباً', 'Soon', 'Bientôt')) : (pick(lang, 'افتح', 'Open', 'Ouvrir'))}</span>
              </div>
            </article>
          )
        })}
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
          <p className="landing-movie-caption">
            <b>{about.movieTitle}</b> · {about.movieBody}
          </p>
          <video
            className="about-movie-video"
            src={movieSrc}
            controls
            playsInline
            preload="metadata"
            onPlay={() => setMoviePlaying(true)}
            onPause={() => setMoviePlaying(false)}
            onEnded={() => setMoviePlaying(false)}
          />
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
          onClick={() => navigate('/advertising/account')}
        >
          {about.adCta}
        </button>
      </section>

      {activeAds.length > 0 && (
        <section className="landing-sponsored" aria-label={pick(lang, 'إعلانات ممولة', 'Sponsored', 'Commandité')}>
          <div className="landing-sponsored-track">
            {activeAds.map((ad) => (
              <figure className="landing-sponsored-card" key={ad.id}>
                <span className="landing-sponsored-tag">{pick(lang, 'إعلان ممول', 'Sponsored', 'Commandité')}</span>
                <img alt={listingDisplayTitle(ad, lang)} loading="lazy" src={adBannerUrl(ad)} />
              </figure>
            ))}
          </div>
        </section>
      )}


    </main>
  )
}
