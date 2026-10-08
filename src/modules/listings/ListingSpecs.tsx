import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { pick, text, type Lang } from '../../engines/language/languageEngine'
import {
  carBrandFilterGroup,
  carFilterGroup,
  carFuelFilterGroup,
  carTransmissionFilterGroup,
  conditionFilterGroup,
  marketFilterGroup,
  propertyFilterGroup,
  type VisualFilterGroup,
} from '../../engines/filters'

// Read-only key-spec list for the listing detail page. It only surfaces values the seller already
// stored (listing.metadata / metadata.visualFilters); rows without a value are hidden, nothing is
// inferred or invented. Several aliases are accepted per field because seller-wizard listings,
// imported inventory and demo data use slightly different metadata keys.

type Tri = [ar: string, en: string, fr: string]

// French (and a few Arabic/English) labels for stored option ids. The shared filter definitions
// carry no French text yet, so without this French users would see English values.
const OPTION_LABELS: Record<string, Tri> = {
  // property types
  apartment: ['شقة', 'Apartment', 'Appartement'],
  villa: ['فيلا', 'Villa', 'Villa'],
  room: ['غرفة', 'Room', 'Chambre'],
  studio: ['استوديو', 'Studio', 'Studio'],
  heritage: ['بيت تراثي', 'Heritage house', 'Maison traditionnelle'],
  farm: ['مزرعة', 'Farm', 'Ferme'],
  chalet: ['شاليه', 'Chalet', 'Chalet'],
  land: ['أرض', 'Land', 'Terrain'],
  office: ['مكتب', 'Office', 'Bureau'],
  shop: ['محل تجاري', 'Shop', 'Local commercial'],
  project: ['مشروع جديد', 'New project', 'Projet neuf'],
  house: ['منزل', 'House', 'Maison'],
  // car bodies
  sedan: ['سيدان', 'Sedan', 'Berline'],
  suv: ['SUV', 'SUV', 'VUS'],
  pickup: ['بيك أب', 'Pickup', 'Camionnette'],
  van: ['فان', 'Van', 'Fourgonnette'],
  luxury: ['فاخر', 'Luxury', 'Luxe'],
  economy: ['اقتصادي', 'Economy', 'Économique'],
  // fuel
  gas: ['بنزين', 'Gasoline', 'Essence'],
  petrol: ['بنزين', 'Gasoline', 'Essence'],
  gasoline: ['بنزين', 'Gasoline', 'Essence'],
  diesel: ['ديزل', 'Diesel', 'Diesel'],
  hybrid: ['هايبرد', 'Hybrid', 'Hybride'],
  electric: ['كهرباء', 'Electric', 'Électrique'],
  // transmission
  automatic: ['أوتوماتيك', 'Automatic', 'Automatique'],
  manual: ['عادي', 'Manual', 'Manuelle'],
  // condition
  new: ['جديد', 'New', 'Neuf'],
  used: ['مستعمل', 'Used', 'Occasion'],
  likeNew: ['شبه جديد', 'Like new', 'Comme neuf'],
  // marketplace categories
  furniture: ['أثاث', 'Furniture', 'Meubles'],
  electronics: ['إلكترونيات', 'Electronics', 'Électronique'],
  appliances: ['أجهزة', 'Appliances', 'Électroménager'],
  services: ['خدمات', 'Services', 'Services'],
}

type Row = { key: string; label: string; display: string }

function firstValue(...values: unknown[]): string {
  for (const raw of values) {
    const value = Array.isArray(raw) ? raw[0] : raw
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(value)
    if (typeof value === 'string' && value.trim() && value.trim() !== 'any') return value.trim()
  }
  return ''
}

function optionLabel(value: string, lang: Lang, group?: VisualFilterGroup) {
  const known = OPTION_LABELS[value]
  if (known) return pick(lang, known[0], known[1], known[2])
  const option = group?.options.find((opt) => opt.id === value)
  if (option) return text(option.label, lang)
  return value
}

function numberText(value: string, lang: Lang) {
  const parsed = Number(value.replace(/[\s,]/g, ''))
  if (!Number.isFinite(parsed)) return value
  return parsed.toLocaleString(pick(lang, 'ar-SY', 'en-US', 'fr-CA'))
}

function furnishedValue(md: Record<string, unknown>, vf: Record<string, unknown>, lang: Lang) {
  const raw = md.furnished ?? vf.furnished ?? md.furnishing ?? vf.furnishing
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === true || value === 'yes' || value === 'furnished' || value === 'true') return pick(lang, 'نعم', 'Yes', 'Oui')
  if (value === false || value === 'no' || value === 'unfurnished' || value === 'false') return pick(lang, 'لا', 'No', 'Non')
  if (value === 'semi' || value === 'semiFurnished' || value === 'partial') return pick(lang, 'جزئياً', 'Partly', 'Partiellement')
  return ''
}

export function listingSpecRows(division: string, metadata: Record<string, unknown> | null | undefined, lang: Lang): Row[] {
  const md = metadata || {}
  const vf = (md.visualFilters as Record<string, unknown> | undefined) || {}
  const rows: Array<Row | null> = []
  const add = (key: string, label: string, display: string) => rows.push(display ? { key, label, display } : null)

  if (division === 'CARS') {
    const brand = firstValue(vf.carBrand, md.carBrand, md.brand, md.make)
    add('brand', pick(lang, 'الماركة', 'Brand', 'Marque'), brand ? optionLabel(brand, lang, carBrandFilterGroup) : '')
    add('model', pick(lang, 'الطراز', 'Model', 'Modèle'), firstValue(md.carModel, md.model, vf.carModel))
    add('year', pick(lang, 'سنة الصنع', 'Year', 'Année'), firstValue(md.carYear, md.year, md.modelYear, vf.carYear))
    const mileage = firstValue(md.mileageKm, md.mileage, md.kilometers, md.odometerKm, vf.mileage)
    add('mileage', pick(lang, 'المسافة المقطوعة', 'Mileage', 'Kilométrage'), mileage ? `${numberText(mileage, lang)} ${pick(lang, 'كم', 'km', 'km')}` : '')
    const fuel = firstValue(vf.carFuel, md.carFuel, md.fuel, md.fuelType)
    add('fuel', pick(lang, 'الوقود', 'Fuel', 'Carburant'), fuel ? optionLabel(fuel, lang, carFuelFilterGroup) : '')
    const transmission = firstValue(vf.carTransmission, md.carTransmission, md.transmission, md.gearbox)
    add('transmission', pick(lang, 'ناقل الحركة', 'Transmission', 'Transmission'), transmission ? optionLabel(transmission, lang, carTransmissionFilterGroup) : '')
    const body = firstValue(vf.carBody, md.carBody, md.bodyType, md.body)
    add('body', pick(lang, 'شكل السيارة', 'Body type', 'Carrosserie'), body ? optionLabel(body, lang, carFilterGroup) : '')
    const condition = firstValue(vf.condition, md.condition)
    add('condition', pick(lang, 'الحالة', 'Condition', 'État'), condition ? optionLabel(condition, lang, conditionFilterGroup) : '')
  } else if (division === 'MARKETPLACE') {
    const category = firstValue(vf.marketCategory, md.marketCategory, md.category)
    add('category', pick(lang, 'التصنيف', 'Category', 'Catégorie'), category ? optionLabel(category, lang, marketFilterGroup) : '')
    const condition = firstValue(vf.condition, md.condition)
    add('condition', pick(lang, 'الحالة', 'Condition', 'État'), condition ? optionLabel(condition, lang, conditionFilterGroup) : '')
  } else {
    const type = firstValue(vf.propertyType, md.propertyType)
    add('type', pick(lang, 'نوع العقار', 'Property type', 'Type de bien'), type ? optionLabel(type, lang, propertyFilterGroup) : '')
    add('beds', pick(lang, 'غرف النوم', 'Bedrooms', 'Chambres'), firstValue(md.bedrooms, vf.bedrooms))
    add('baths', pick(lang, 'الحمامات', 'Bathrooms', 'Salles de bain'), firstValue(md.bathrooms, vf.bathrooms))
    const size = firstValue(md.sizeSqm, md.areaSqm, md.surfaceSqm, md.area_m2, md.sqm)
    add('size', pick(lang, 'المساحة', 'Area', 'Superficie'), size ? `${numberText(size, lang)} ${pick(lang, 'م²', 'm²', 'm²')}` : '')
    add('furnished', pick(lang, 'مفروش', 'Furnished', 'Meublé'), furnishedValue(md, vf, lang))
    if (division === 'NEW_CONSTRUCTION') {
      add('phase', pick(lang, 'مرحلة المشروع', 'Project phase', 'Phase du projet'), firstValue(md.projectPhase))
    }
  }

  return rows.filter((row): row is Row => Boolean(row))
}

export function ListingSpecs({ division, metadata, lang }: { division: string; metadata: Record<string, unknown> | null | undefined; lang: Lang }) {
  const rows = useMemo(() => listingSpecRows(division, metadata, lang), [division, metadata, lang])
  if (rows.length === 0) return null
  const heading =
    division === 'CARS'
      ? pick(lang, 'مواصفات المركبة', 'Vehicle specifications', 'Caractéristiques du véhicule')
      : division === 'MARKETPLACE'
        ? pick(lang, 'تفاصيل المنتج', 'Item details', 'Détails de l’article')
        : division === 'NEW_CONSTRUCTION'
          ? pick(lang, 'تفاصيل المشروع', 'Project details', 'Détails du projet')
          : pick(lang, 'تفاصيل العقار', 'Property details', 'Détails du bien')

  return (
    <section style={styles.specGrid} aria-label={heading}>
      <strong>{heading}</strong>
      <dl style={styles.specList}>
        {rows.map((row) => (
          <div key={row.key} style={styles.specRow}>
            <dt style={styles.specLabel}>{row.label}</dt>
            <dd style={styles.specValue}>{row.display}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  specGrid: { border: '1px solid #30384d', borderRadius: 10, background: '#151620', padding: 14, display: 'grid', gap: 10 },
  specList: { display: 'grid', gap: 8, margin: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', columnGap: 20 },
  specRow: { display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #232635', paddingBottom: 6 },
  specLabel: { color: '#9aa6ba', fontWeight: 700, margin: 0 },
  specValue: { color: '#fff', fontWeight: 800, margin: 0, textAlign: 'end' },
}
