import { useState, type CSSProperties, type ReactNode } from 'react'
import { pick, text, type Lang } from '../../engines/language/languageEngine'
import type { VisualFilterArt, VisualFilterGroup, VisualFilterOption, VisualFilterSelection } from '../../engines/filters'

type Props = {
  groups: VisualFilterGroup[]
  lang: Lang
  onChange: (selection: VisualFilterSelection) => void
  selection: VisualFilterSelection
  compact?: boolean
}

export function VisualFilterPanel({ compact = false, groups, lang, onChange, selection }: Props) {
  return (
    <section style={compact ? styles.compactPanel : styles.panel} aria-label={pick(lang, 'خيارات لمس', 'Touch options', 'Options tactiles')}>
      {groups.map((group) => (
        <fieldset key={group.id} style={compact ? styles.compactGroup : styles.group}>
          <legend style={styles.legend}>{text(group.title, lang)}</legend>
          <div style={compact ? styles.compactGrid : styles.grid}>
            {group.options.map((option) => {
              const selected = isSelected(selection[group.id], option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  title={text(option.label, lang)}
                  onClick={() => onChange(nextSelection(selection, group, option))}
                  style={{ ...(selected ? styles.tileActive : styles.tile), ...(compact ? styles.compactTile : {}) }}
                >
                  <span style={styles.picture}>
                    <FilterPicture lang={lang} option={option} />
                  </span>
                  <span style={styles.label}>{text(option.label, lang)}</span>
                  {selected ? <span style={styles.check}>✓</span> : null}
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}
    </section>
  )
}

export function selectedFilterLabels(groups: VisualFilterGroup[], selection: VisualFilterSelection, lang: Lang) {
  return groups.flatMap((group) => {
    const current = selection[group.id]
    const values = Array.isArray(current) ? current : current && current !== 'any' ? [current] : []
    return values
      .map((value) => group.options.find((option) => option.id === value)?.label)
      .map((label) => (label ? text(label, lang) : undefined))
      .filter(Boolean) as string[]
  })
}

function isSelected(current: string | string[] | undefined, optionId: string) {
  if (Array.isArray(current)) return current.includes(optionId)
  return (current || 'any') === optionId
}

function nextSelection(selection: VisualFilterSelection, group: VisualFilterGroup, option: VisualFilterOption) {
  if (group.mode === 'single') return { ...selection, [group.id]: option.id }

  const current = Array.isArray(selection[group.id]) ? (selection[group.id] as string[]) : []
  const next = current.includes(option.id)
    ? current.filter((item) => item !== option.id)
    : [...current, option.id]
  return { ...selection, [group.id]: next }
}

function FilterPicture({ lang, option }: { lang: Lang; option: VisualFilterOption }) {
  const [photoFailed, setPhotoFailed] = useState(false)
  if (option.photoSrc && !photoFailed) {
    return (
      <span style={styles.photoFrame}>
        <img
          src={option.photoSrc}
          alt={(option.photoAlt ? text(option.photoAlt, lang) : '') || text(option.label, lang)}
          loading="lazy"
          onError={() => setPhotoFailed(true)}
          style={{ ...styles.photo, objectPosition: option.photoPosition || '50% 50%' }}
        />
      </span>
    )
  }
  return pictureFor(option.art)
}

function pictureFor(art: VisualFilterArt): ReactNode {
  if (art.startsWith('room-')) return <RoomPicture variant={art} />
  if (art.startsWith('bed-')) return <BedPicture variant={art} />
  if (art.startsWith('property-')) return <PropertyPicture variant={art} />
  if (art.startsWith('amenity-')) return <AmenityPicture variant={art} />
  if (art.startsWith('meal-')) return <MealPicture variant={art} />
  if (art.startsWith('hotel-star-')) return <HotelStarPicture variant={art} />
  if (art.startsWith('access-')) return <AccessPicture variant={art} />
  if (art.startsWith('trust-')) return <TrustPicture variant={art} />
  if (art.startsWith('car-')) return <CarPicture variant={art} />
  if (art.startsWith('market-')) return <MarketPicture variant={art} />
  if (art.startsWith('price-')) return <PricePicture variant={art} />
  if (art.startsWith('sort-')) return <SortPicture variant={art} />
  if (art.startsWith('condition-')) return <ConditionPicture variant={art} />
  return <span style={styles.anyPicture}>*</span>
}

function RoomPicture({ variant }: { variant: string }) {
  const isDouble = variant === 'room-double'
  const isSuite = variant === 'room-suite'
  const isStudio = variant === 'room-studio'
  const isFamily = variant === 'room-family'
  const isAny = variant === 'room-any'
  return (
    <span style={styles.scene}>
      <span style={styles.backWall} />
      {isAny ? <><span style={styles.roomGridA} /><span style={styles.roomGridB} /><span style={styles.roomGridC} /></> : null}
      {!isAny ? <span style={{ ...styles.bedBase, width: isSuite ? 30 : isFamily ? 34 : isDouble ? 25 : 18, left: isSuite ? 13 : isFamily ? 12 : isDouble ? 17 : 21 }} /> : null}
      {isDouble || isFamily ? <span style={{ ...styles.bedBase, width: isFamily ? 13 : 16, left: 14, top: 28 }} /> : null}
      {isFamily ? <span style={{ ...styles.bedBase, width: 13, left: 31, top: 28 }} /> : null}
      {isSuite || isStudio ? <span style={styles.sofa} /> : null}
      {isStudio ? <span style={styles.studioCounter} /> : null}
      <span style={styles.window} />
    </span>
  )
}

function BedPicture({ variant }: { variant: string }) {
  const width = variant === 'bed-single' ? 21 : variant === 'bed-double' ? 29 : variant === 'bed-queen' ? 34 : variant === 'bed-king' ? 39 : 31
  const isSofa = variant === 'bed-sofa'
  return (
    <span style={styles.scene}>
      <span style={{ ...styles.pillow, left: 13 }} />
      {!isSofa ? <span style={{ ...styles.pillow, left: 34, display: width > 28 ? 'block' : 'none' }} /> : null}
      <span style={{ ...styles.bedFrame, width, left: Math.max(9, 34 - width / 2) }} />
      {isSofa ? <span style={styles.sofaBack} /> : null}
    </span>
  )
}

function PropertyPicture({ variant }: { variant: string }) {
  const roof = variant === 'property-villa' || variant === 'property-chalet' || variant === 'property-project'
  const tall = variant === 'property-apartment' || variant === 'property-office'
  const land = variant === 'property-farm' || variant === 'property-land'
  const shop = variant === 'property-shop'
  return (
    <span style={styles.scene}>
      {roof ? <span style={styles.roof} /> : null}
      {variant === 'property-land' ? null : <span style={{ ...styles.house, height: tall ? 34 : 25, top: tall ? 13 : 22, borderRadius: variant === 'property-room' ? 14 : 4 }} />}
      {land ? <span style={styles.field} /> : null}
      {shop ? <span style={styles.shopAwning} /> : null}
      {variant === 'property-project' ? <span style={styles.crane} /> : null}
      {variant !== 'property-land' ? <span style={styles.door} /> : null}
      {variant !== 'property-land' ? <span style={styles.houseWindow} /> : null}
    </span>
  )
}

function AmenityPicture({ variant }: { variant: string }) {
  return (
    <span style={styles.scene}>
      {variant === 'amenity-wifi' ? <><span style={styles.wifiArc1} /><span style={styles.wifiArc2} /><span style={styles.wifiDot} /></> : null}
      {variant === 'amenity-parking' ? <span style={styles.parking}>P</span> : null}
      {variant === 'amenity-breakfast' ? <><span style={styles.cup} /><span style={styles.plate} /></> : null}
      {variant === 'amenity-generator' ? <><span style={styles.generator} /><span style={styles.bolt}>Z</span></> : null}
      {variant === 'amenity-kitchen' ? <><span style={styles.pan} /><span style={styles.handle} /></> : null}
      {variant === 'amenity-ac' ? <><span style={styles.acBox} /><span style={styles.snow}>*</span></> : null}
      {variant === 'amenity-balcony' ? <><span style={styles.balconyRail} /><span style={styles.balconyBase} /></> : null}
      {variant === 'amenity-pool' ? <><span style={styles.pool} /><span style={styles.wave} /></> : null}
      {variant === 'amenity-heating' ? <><span style={styles.heatWaveA} /><span style={styles.heatWaveB} /><span style={styles.heatBase} /></> : null}
      {variant === 'amenity-tv' ? <><span style={styles.tvScreen} /><span style={styles.screenBase} /></> : null}
      {variant === 'amenity-garden' ? <><span style={styles.gardenStem} /><span style={styles.gardenLeafA} /><span style={styles.gardenLeafB} /></> : null}
      {variant === 'amenity-elevator' ? <><span style={styles.elevatorBox} /><span style={styles.elevatorArrowUp}>↑</span><span style={styles.elevatorArrowDown}>↓</span></> : null}
    </span>
  )
}

function TrustPicture({ variant }: { variant: string }) {
  const content = variant === 'trust-rating' ? '8+' : variant === 'trust-fast' ? '↯' : variant === 'trust-family' ? '2+' : variant === 'trust-instant' ? '⚡' : '✓'
  return (
    <span style={styles.scene}>
      <span style={styles.badgeCircle}>{content}</span>
    </span>
  )
}

function AccessPicture({ variant }: { variant: string }) {
  const content = variant === 'access-parking' ? 'P' : variant === 'access-ramp' ? '↗' : '♿'
  return (
    <span style={styles.scene}>
      <span style={styles.badgeCircle}>{content}</span>
    </span>
  )
}

function MealPicture({ variant }: { variant: string }) {
  const content = variant === 'meal-lunch' ? 'L' : variant === 'meal-dinner' ? 'D' : variant === 'meal-buffet' ? 'B' : 'AI'
  return (
    <span style={styles.scene}>
      <span style={styles.plate} />
      <span style={styles.cup} />
      <span style={styles.badgeCircle}>{content}</span>
    </span>
  )
}

function HotelStarPicture({ variant }: { variant: string }) {
  const count = Number(variant.replace('hotel-star-', '')) || 1
  return (
    <span style={styles.scene}>
      <span style={styles.hotelBlock} />
      <span style={styles.hotelRoofLine} />
      <span style={styles.hotelStarRow}>
        {Array.from({ length: count }).map((_, index) => (
          <span key={index} style={styles.hotelStar}>★</span>
        ))}
      </span>
    </span>
  )
}

function CarPicture({ variant }: { variant: string }) {
  const tall = variant === 'car-suv' || variant === 'car-van'
  const bed = variant === 'car-pickup'
  const mark = carMark(variant)
  return (
    <span style={styles.scene}>
      <span style={{ ...styles.carBody, height: tall ? 20 : 15, width: bed ? 43 : 39 }} />
      <span style={styles.carTop} />
      <span style={styles.wheelLeft} />
      <span style={styles.wheelRight} />
      {mark ? <span style={styles.carMark}>{mark}</span> : null}
    </span>
  )
}

function carMark(variant: string) {
  const map: Record<string, string> = {
    'car-luxury': '+',
    'car-economy': '$',
    'car-toyota': 'T',
    'car-hyundai': 'H',
    'car-kia': 'K',
    'car-mercedes': 'M',
    'car-bmw': 'B',
    'car-electric': 'E',
    'car-gas': 'G',
    'car-diesel': 'D',
    'car-hybrid': 'H',
    'car-manual': 'M',
    'car-automatic': 'A',
  }
  return map[variant]
}

function MarketPicture({ variant }: { variant: string }) {
  return (
    <span style={styles.scene}>
      {variant === 'market-furniture' ? <><span style={styles.sofaBack} /><span style={styles.sofa} /></> : null}
      {variant === 'market-electronics' ? <><span style={styles.screen} /><span style={styles.screenBase} /></> : null}
      {variant === 'market-appliances' ? <span style={styles.appliance} /> : null}
      {variant === 'market-services' ? <><span style={styles.serviceCircle} /><span style={styles.serviceLine} /></> : null}
    </span>
  )
}

function PricePicture({ variant }: { variant: string }) {
  const bars = variant === 'price-low' ? [12, 18, 24] : variant === 'price-mid' ? [18, 25, 32] : variant === 'price-high' ? [24, 32, 40] : [18, 18, 18]
  return (
    <span style={styles.scene}>
      {bars.map((height, index) => (
        <span key={index} style={{ ...styles.priceBar, height, left: 17 + index * 11 }} />
      ))}
    </span>
  )
}

function SortPicture({ variant }: { variant: string }) {
  return (
    <span style={styles.scene}>
      <span style={styles.sortLineWide} />
      <span style={styles.sortLineMid} />
      <span style={styles.sortLineSmall} />
      <span style={styles.sortArrow}>{variant === 'sort-high' ? '↑' : '↓'}</span>
    </span>
  )
}

function ConditionPicture({ variant }: { variant: string }) {
  return (
    <span style={styles.scene}>
      <span style={variant === 'condition-new' ? styles.sparkLarge : styles.usedMark} />
      <span style={variant === 'condition-new' ? styles.sparkSmall : styles.usedMarkSmall} />
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: { border: '1px solid #30384d', borderRadius: 22, background: 'rgba(12,18,32,.92)', display: 'grid', gap: 14, padding: 14, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.04)' },
  compactPanel: { display: 'grid', gap: 12 },
  group: { border: '1px solid #30384d', borderRadius: 20, background: '#111827', margin: 0, minWidth: 0, padding: '12px 12px 14px' },
  compactGroup: { border: '1px solid #30384d', borderRadius: 18, background: '#0c1220', margin: 0, minWidth: 0, padding: '10px' },
  legend: { color: '#c4cce0', fontSize: 13, fontWeight: 950, padding: '0 8px' },
  grid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))' },
  compactGrid: { display: 'flex', gap: 10, overflowX: 'auto', overscrollBehaviorInline: 'contain', padding: '2px 2px 8px', scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch' },
  tile: { border: '1px solid #30384d', borderRadius: 18, background: '#0c1220', color: '#c1cade', display: 'grid', gap: 9, justifyItems: 'center', minHeight: 136, minWidth: 126, padding: 10, position: 'relative', touchAction: 'manipulation', scrollSnapAlign: 'start', WebkitTapHighlightColor: 'transparent', boxShadow: '0 14px 34px rgba(0,0,0,.18)' },
  tileActive: { border: '1px solid #8da0ff', borderRadius: 18, background: 'linear-gradient(180deg,#33449b,#263575)', color: '#fff', display: 'grid', gap: 9, justifyItems: 'center', minHeight: 136, minWidth: 126, padding: 10, position: 'relative', touchAction: 'manipulation', scrollSnapAlign: 'start', WebkitTapHighlightColor: 'transparent', boxShadow: '0 18px 40px rgba(79,108,255,.25)' },
  compactTile: { flex: '0 0 132px' },
  picture: { width: 104, height: 78, display: 'grid', placeItems: 'center' },
  photoFrame: { width: 104, height: 78, borderRadius: 15, border: '1px solid #3d4963', display: 'block', overflow: 'hidden', position: 'relative', background: '#0b1120' },
  photo: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  label: { fontSize: 13, fontWeight: 950, lineHeight: 1.25, maxWidth: 116, overflowWrap: 'anywhere', textAlign: 'center' },
  check: { position: 'absolute', top: 8, insetInlineEnd: 8, width: 24, height: 24, borderRadius: 999, background: '#20d29b', color: '#051014', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 950, boxShadow: '0 8px 18px rgba(32,210,155,.28)' },
  scene: { width: 58, height: 48, borderRadius: 10, background: 'linear-gradient(180deg,#162137,#0b1120)', border: '1px solid #34415d', display: 'block', position: 'relative', overflow: 'hidden' },
  anyPicture: { width: 42, height: 42, borderRadius: 12, border: '1px solid #4f6cff', color: '#d5a915', display: 'grid', fontSize: 22, fontWeight: 950, placeItems: 'center' },
  backWall: { position: 'absolute', insetInlineStart: 8, top: 8, width: 42, height: 28, border: '1px solid #4f6cff55', borderRadius: 4 },
  bedBase: { position: 'absolute', top: 31, height: 8, borderRadius: 3, background: '#d5a915' },
  sofa: { position: 'absolute', top: 23, insetInlineStart: 31, width: 16, height: 9, borderRadius: '6px 6px 3px 3px', background: '#20d29b' },
  window: { position: 'absolute', top: 13, insetInlineStart: 13, width: 10, height: 9, borderRadius: 2, background: '#19d7ff' },
  roomGridA: { position: 'absolute', insetInlineStart: 12, top: 16, width: 13, height: 10, borderRadius: 2, background: '#4f6cff' },
  roomGridB: { position: 'absolute', insetInlineStart: 29, top: 16, width: 13, height: 10, borderRadius: 2, background: '#20d29b' },
  roomGridC: { position: 'absolute', insetInlineStart: 21, top: 30, width: 13, height: 10, borderRadius: 2, background: '#d5a915' },
  studioCounter: { position: 'absolute', insetInlineStart: 9, top: 35, width: 18, height: 5, borderRadius: 99, background: '#f8fafc' },
  pillow: { position: 'absolute', top: 17, width: 10, height: 8, borderRadius: 3, background: '#f8fafc' },
  bedFrame: { position: 'absolute', top: 25, height: 15, borderRadius: 4, background: '#d5a915' },
  sofaBack: { position: 'absolute', top: 17, insetInlineStart: 13, width: 32, height: 12, borderRadius: '9px 9px 3px 3px', background: '#4f6cff' },
  roof: { position: 'absolute', top: 12, insetInlineStart: 16, width: 28, height: 28, background: '#d5a915', transform: 'rotate(45deg)' },
  house: { position: 'absolute', insetInlineStart: 16, width: 27, background: '#4f6cff' },
  field: { position: 'absolute', insetInlineStart: 5, bottom: 7, width: 48, height: 7, borderRadius: 99, background: '#20d29b' },
  shopAwning: { position: 'absolute', insetInlineStart: 15, top: 19, width: 29, height: 6, borderRadius: '6px 6px 1px 1px', background: '#d5a915' },
  crane: { position: 'absolute', insetInlineStart: 8, top: 8, width: 35, height: 3, borderRadius: 99, background: '#d5a915', transform: 'rotate(-8deg)' },
  door: { position: 'absolute', insetInlineStart: 27, bottom: 8, width: 7, height: 13, borderRadius: '3px 3px 0 0', background: '#101827' },
  houseWindow: { position: 'absolute', insetInlineStart: 19, top: 24, width: 7, height: 7, borderRadius: 2, background: '#19d7ff' },
  wifiArc1: { position: 'absolute', insetInlineStart: 15, top: 13, width: 28, height: 28, borderTop: '4px solid #19d7ff', borderRadius: 999 },
  wifiArc2: { position: 'absolute', insetInlineStart: 22, top: 22, width: 14, height: 14, borderTop: '4px solid #19d7ff', borderRadius: 999 },
  wifiDot: { position: 'absolute', insetInlineStart: 27, top: 34, width: 6, height: 6, borderRadius: 999, background: '#19d7ff' },
  parking: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#19d7ff', fontSize: 30, fontWeight: 950 },
  cup: { position: 'absolute', insetInlineStart: 18, top: 18, width: 19, height: 17, borderRadius: '0 0 8px 8px', background: '#d5a915' },
  plate: { position: 'absolute', insetInlineStart: 12, top: 38, width: 34, height: 4, borderRadius: 99, background: '#f8fafc' },
  generator: { position: 'absolute', insetInlineStart: 12, top: 17, width: 34, height: 22, borderRadius: 4, background: '#4f6cff' },
  bolt: { position: 'absolute', insetInlineStart: 25, top: 15, color: '#d5a915', fontWeight: 950 },
  pan: { position: 'absolute', insetInlineStart: 16, top: 20, width: 24, height: 16, borderRadius: '4px 4px 10px 10px', background: '#d5a915' },
  handle: { position: 'absolute', insetInlineStart: 39, top: 25, width: 11, height: 4, borderRadius: 99, background: '#d5a915' },
  acBox: { position: 'absolute', insetInlineStart: 12, top: 13, width: 35, height: 12, borderRadius: 3, background: '#f8fafc' },
  snow: { position: 'absolute', insetInlineStart: 25, top: 25, color: '#19d7ff', fontWeight: 950 },
  balconyRail: { position: 'absolute', insetInlineStart: 13, top: 20, width: 32, height: 17, border: '2px solid #d5a915', borderTop: 0 },
  balconyBase: { position: 'absolute', insetInlineStart: 9, top: 37, width: 40, height: 4, borderRadius: 99, background: '#d5a915' },
  pool: { position: 'absolute', insetInlineStart: 10, top: 26, width: 38, height: 13, borderRadius: 999, background: '#19d7ff' },
  wave: { position: 'absolute', insetInlineStart: 17, top: 28, color: '#0c1220', fontWeight: 950 },
  heatWaveA: { position: 'absolute', insetInlineStart: 18, top: 13, width: 6, height: 22, borderRadius: 999, borderInlineEnd: '3px solid #d5a915' },
  heatWaveB: { position: 'absolute', insetInlineStart: 31, top: 13, width: 6, height: 22, borderRadius: 999, borderInlineEnd: '3px solid #d5a915' },
  heatBase: { position: 'absolute', insetInlineStart: 15, top: 36, width: 30, height: 4, borderRadius: 99, background: '#d5a915' },
  tvScreen: { position: 'absolute', insetInlineStart: 12, top: 13, width: 34, height: 21, borderRadius: 4, background: '#19d7ff', border: '2px solid #f8fafc' },
  gardenStem: { position: 'absolute', insetInlineStart: 28, top: 21, width: 4, height: 19, borderRadius: 99, background: '#20d29b' },
  gardenLeafA: { position: 'absolute', insetInlineStart: 16, top: 17, width: 16, height: 11, borderRadius: '999px 999px 0 999px', background: '#20d29b' },
  gardenLeafB: { position: 'absolute', insetInlineStart: 29, top: 15, width: 16, height: 11, borderRadius: '999px 999px 999px 0', background: '#20d29b' },
  elevatorBox: { position: 'absolute', insetInlineStart: 17, top: 10, width: 24, height: 31, borderRadius: 4, border: '2px solid #19d7ff' },
  elevatorArrowUp: { position: 'absolute', insetInlineStart: 21, top: 14, color: '#d5a915', fontSize: 15, fontWeight: 950 },
  elevatorArrowDown: { position: 'absolute', insetInlineStart: 33, top: 23, color: '#d5a915', fontSize: 15, fontWeight: 950 },
  badgeCircle: { position: 'absolute', insetInlineStart: 13, top: 9, width: 32, height: 32, borderRadius: 999, background: '#20d29b', color: '#06110e', display: 'grid', placeItems: 'center', fontWeight: 950 },
  hotelBlock: { position: 'absolute', insetInlineStart: 12, top: 17, width: 34, height: 23, borderRadius: 5, background: '#4f6cff' },
  hotelRoofLine: { position: 'absolute', insetInlineStart: 14, top: 12, width: 30, height: 5, borderRadius: 99, background: '#d5a915' },
  hotelStarRow: { position: 'absolute', insetInlineStart: 6, top: 23, width: 46, display: 'flex', justifyContent: 'center', gap: 1 },
  hotelStar: { color: '#d5a915', fontSize: 9, fontWeight: 950, lineHeight: 1 },
  carBody: { position: 'absolute', insetInlineStart: 9, top: 24, borderRadius: '8px 8px 4px 4px', background: '#4f6cff' },
  carTop: { position: 'absolute', insetInlineStart: 20, top: 15, width: 19, height: 12, borderRadius: '7px 7px 0 0', background: '#19d7ff' },
  carMark: { position: 'absolute', insetInlineStart: 23, top: 9, width: 13, height: 13, borderRadius: 999, background: '#d5a915', color: '#101827', display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 950 },
  wheelLeft: { position: 'absolute', insetInlineStart: 15, top: 36, width: 8, height: 8, borderRadius: 999, background: '#101827', border: '2px solid #f8fafc' },
  wheelRight: { position: 'absolute', insetInlineStart: 36, top: 36, width: 8, height: 8, borderRadius: 999, background: '#101827', border: '2px solid #f8fafc' },
  screen: { position: 'absolute', insetInlineStart: 12, top: 13, width: 34, height: 23, borderRadius: 4, background: '#19d7ff' },
  screenBase: { position: 'absolute', insetInlineStart: 24, top: 37, width: 12, height: 5, borderRadius: 2, background: '#f8fafc' },
  appliance: { position: 'absolute', insetInlineStart: 18, top: 10, width: 24, height: 32, borderRadius: 5, background: '#f8fafc' },
  serviceCircle: { position: 'absolute', insetInlineStart: 17, top: 13, width: 24, height: 24, borderRadius: 999, background: '#d5a915' },
  serviceLine: { position: 'absolute', insetInlineStart: 27, top: 10, width: 4, height: 30, borderRadius: 99, background: '#0c1220', transform: 'rotate(45deg)' },
  priceBar: { position: 'absolute', bottom: 9, width: 8, borderRadius: '4px 4px 0 0', background: '#d5a915' },
  sortLineWide: { position: 'absolute', insetInlineStart: 13, top: 14, width: 31, height: 4, borderRadius: 99, background: '#f8fafc' },
  sortLineMid: { position: 'absolute', insetInlineStart: 13, top: 23, width: 24, height: 4, borderRadius: 99, background: '#9aa6ba' },
  sortLineSmall: { position: 'absolute', insetInlineStart: 13, top: 32, width: 16, height: 4, borderRadius: 99, background: '#6f7b91' },
  sortArrow: { position: 'absolute', insetInlineEnd: 9, top: 18, color: '#d5a915', fontWeight: 950, fontSize: 20 },
  sparkLarge: { position: 'absolute', insetInlineStart: 18, top: 14, width: 22, height: 22, borderRadius: 6, background: '#20d29b', transform: 'rotate(45deg)' },
  sparkSmall: { position: 'absolute', insetInlineStart: 35, top: 12, width: 8, height: 8, borderRadius: 999, background: '#d5a915' },
  usedMark: { position: 'absolute', insetInlineStart: 14, top: 15, width: 30, height: 18, borderRadius: 999, border: '4px solid #d5a915' },
  usedMarkSmall: { position: 'absolute', insetInlineStart: 35, top: 31, width: 8, height: 8, borderRadius: 999, background: '#d5a915' },
}
