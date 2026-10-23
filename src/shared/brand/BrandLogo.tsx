import type { CSSProperties } from 'react'
import { getLogoAsset } from './logoRegistry'
import { BRAND_NAME, IS_PLATFORM_BRAND } from './brandName'
import type { LogoKey } from './logoRegistry'

type BrandLogoProps = {
  logo: LogoKey
  size?: 'nav' | 'card' | 'hero'
  className?: string
}

const SIZE_STYLES: Record<NonNullable<BrandLogoProps['size']>, CSSProperties> = {
  nav: { width: 148, height: 48 },
  card: { width: 190, height: 88 },
  hero: { width: 260, height: 128 },
}

export function BrandLogo({ logo, size = 'nav', className }: BrandLogoProps) {
  const asset = getLogoAsset(logo)
  // White-label builds (Rezekme) show their own wordmark instead of the SYBNB artwork.
  if (!IS_PLATFORM_BRAND) {
    return (
      <span className={className} data-wordmark="text" style={{ ...styles.wrap, ...SIZE_STYLES[size], ...styles.wordmark }}>
        {BRAND_NAME}
      </span>
    )
  }
  return (
    <span className={className} style={{ ...styles.wrap, ...SIZE_STYLES[size] }}>
      <img src={asset.src} alt={asset.label} style={styles.image} />
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    alignItems: 'center',
    display: 'inline-flex',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // A text wordmark sizes to its text: the fixed logo-box widths (made for the SYBNB artwork, and
  // narrower on phones) cropped "Rezekme" to "ezekm" in the phone header.
  wordmark: {
    color: '#2b3bea',
    fontSize: 'clamp(20px, 5.5vw, 26px)',
    fontWeight: 800,
    letterSpacing: '-0.02em',
    width: 'auto',
    maxWidth: 'none',
    overflow: 'visible',
    whiteSpace: 'nowrap',
    lineHeight: 1.1,
  },
  image: {
    display: 'block',
    height: '100%',
    objectFit: 'contain',
    width: '100%',
  },
}
