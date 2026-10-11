import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../../shared/api/platformApi'

// Virtual tour (Centris-depth, 2026-10-11). Reads metadata.virtualTourUrl (set in the seller wizard)
// and renders a safe embed. Supports YouTube, Matterport, and any https iframe-able tour URL.
function toEmbedUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = url.searchParams.get('v')
    if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`
  }
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1)
    if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`
  }
  // Matterport, Kuula, and generic providers are iframe-able as-is.
  return url.toString()
}

export function VirtualTourEmbed({ listing, lang }: { listing: PlatformListing; lang: Lang }) {
  const raw = (listing.metadata as { virtualTourUrl?: unknown })?.virtualTourUrl
  if (typeof raw !== 'string' || !raw.trim()) return null
  const embed = toEmbedUrl(raw.trim())
  if (!embed) return null
  return (
    <section style={styles.wrap}>
      <strong style={styles.title}>
        🎬 {pick(lang, 'جولة افتراضية', 'Virtual tour', 'Visite virtuelle')}
      </strong>
      <div style={styles.frameWrap}>
        <iframe
          src={embed}
          title={pick(lang, 'جولة افتراضية', 'Virtual tour', 'Visite virtuelle')}
          style={styles.frame}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; xr-spatial-tracking; fullscreen"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 10, marginTop: 16, padding: 16, borderRadius: 16, border: '1px solid #e6e9ee', background: '#fff' },
  title: { fontSize: 15 },
  frameWrap: { position: 'relative', width: '100%', paddingTop: '56.25%', borderRadius: 12, overflow: 'hidden', background: '#000' },
  frame: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' },
}
