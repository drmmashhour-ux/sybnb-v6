import { useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { getCity, getGovernorate, labelFor, SYRIA_GOVERNORATES } from '../../engines/search'

export type LocationValue = {
  governorate: string
  city: string
  area: string
}

type LocationCascadeProps = {
  lang: Lang
  value: LocationValue
  onChange: (value: LocationValue) => void
  // When given, the governorate panel offers "All of Syria" to drop the location filter.
  onClear?: () => void
}

const T = {
  ar: {
    governorate: 'المحافظة / الولاية',
    city: 'المدينة / القضاء',
    area: 'المنطقة / الشارع',
    chooseGovernorate: 'اختر المحافظة أولاً',
    chooseCity: 'اختر المدينة أولاً',
    chooseArea: 'اختر المنطقة',
    allGovernorates: 'كل المحافظات',
    cities: 'المدن / الأقضية',
    areas: 'المناطق / الشوارع',
    allSyria: 'كل سوريا',
  },
  en: {
    governorate: 'Governorate / State',
    city: 'City / District',
    area: 'Area / Street',
    chooseGovernorate: 'Choose governorate first',
    chooseCity: 'Choose city first',
    chooseArea: 'Choose area',
    allGovernorates: 'All governorates',
    cities: 'Cities / Districts',
    areas: 'Areas / Streets',
    allSyria: 'All of Syria',
  },
  fr: {
    governorate: 'Gouvernorat / État',
    city: 'Ville / District',
    area: 'Quartier / Rue',
    chooseGovernorate: 'Choisissez d’abord le gouvernorat',
    chooseCity: 'Choisissez d’abord la ville',
    chooseArea: 'Choisissez le quartier',
    allGovernorates: 'Tous les gouvernorats',
    cities: 'Villes / Districts',
    areas: 'Quartiers / Rues',
    allSyria: 'Toute la Syrie',
  },
}

const AR_LABEL_OVERRIDES: Record<string, string> = {
  duma: 'دوما',
  qatana: 'قطنا',
  'az-zabdani': 'الزبداني',
  'at-tall': 'التل',
  'an-nabk': 'النبك',
  'al-qutayfah': 'القطيفة',
  yabroud: 'يبرود',
}

type Panel = 'governorate' | 'city' | 'area'

export function LocationCascade({ lang, value, onChange, onClear }: LocationCascadeProps) {
  const [openPanel, setOpenPanel] = useState<Panel | null>(null)
  const governorate = getGovernorate(value.governorate)
  const city = getCity(value.governorate, value.city)
  const t = T[lang]
  const displayLabel = (item?: { key?: string; ar: string; en: string }) => {
    if (!item) return ''
    return lang === 'ar' && item.key && AR_LABEL_OVERRIDES[item.key] ? AR_LABEL_OVERRIDES[item.key] : labelFor(lang, item)
  }
  const selectGovernorate = (key: string) => {
    const nextGovernorate = getGovernorate(key)
    onChange({ governorate: key, city: nextGovernorate?.cities[0]?.key || '', area: '' })
    setOpenPanel('city')
  }
  const selectCity = (key: string) => {
    onChange({ ...value, city: key, area: '' })
    setOpenPanel('area')
  }
  const selectArea = (key: string) => {
    onChange({ ...value, area: key })
    setOpenPanel(null)
  }

  return (
    <div style={styles.shell}>
      <div style={styles.searchRow} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <TouchField label={t.governorate} value={displayLabel(governorate) || t.allSyria} active={openPanel === 'governorate'} onClick={() => setOpenPanel(openPanel === 'governorate' ? null : 'governorate')} />
        <TouchField label={t.city} value={displayLabel(city) || (governorate ? t.chooseCity : t.chooseGovernorate)} active={openPanel === 'city'} onClick={() => setOpenPanel(openPanel === 'city' ? null : 'city')} />
        <TouchField
          label={t.area}
          value={displayLabel(city?.areas.find((item) => item.key === value.area)) || (city ? t.chooseArea : t.chooseCity)}
          active={openPanel === 'area'}
          onClick={() => setOpenPanel(openPanel === 'area' ? null : 'area')}
        />
      </div>

      {openPanel === 'governorate' && (
        <TouchPanel label={t.allGovernorates}>
          <div style={styles.govGrid}>
            {onClear ? (
              <ChoiceButton active={!value.governorate} onClick={() => { onClear(); setOpenPanel(null) }}>
                {t.allSyria}
              </ChoiceButton>
            ) : null}
            {SYRIA_GOVERNORATES.map((item) => (
              <ChoiceButton key={item.key} active={item.key === value.governorate} onClick={() => selectGovernorate(item.key)}>
                {displayLabel(item)}
              </ChoiceButton>
            ))}
          </div>
        </TouchPanel>
      )}

      {openPanel === 'city' && (
        <TouchPanel label={t.cities}>
          <div style={styles.govGrid}>
            {governorate?.cities.map((item) => (
              <ChoiceButton key={item.key} active={item.key === value.city} onClick={() => selectCity(item.key)}>
                {displayLabel(item)}
              </ChoiceButton>
            ))}
          </div>
        </TouchPanel>
      )}

      {openPanel === 'area' && (
        <TouchPanel label={t.areas}>
          <div style={styles.areaGrid}>
            {city?.areas.slice(0, 36).map((item) => (
              <ChoiceButton key={item.key} active={item.key === value.area} onClick={() => selectArea(item.key)} area>
                {displayLabel(item)}
              </ChoiceButton>
            ))}
          </div>
        </TouchPanel>
      )}
    </div>
  )
}

function TouchField({ label, value, active, onClick }: { label: string; value: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ ...styles.fieldButton, ...(active ? styles.fieldButtonActive : {}) }}>
      <span style={styles.fieldLabel}>{label}</span>
      <strong style={styles.fieldValue}>{value}</strong>
    </button>
  )
}

function TouchPanel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.govPanel} aria-label={label}>
      <span style={styles.govPanelLabel}>{label}</span>
      {children}
    </div>
  )
}

function ChoiceButton({ active, onClick, children, area = false }: { active: boolean; onClick: () => void; children: React.ReactNode; area?: boolean }) {
  return (
    <button type="button" onClick={onClick} style={{ ...(area ? styles.areaButton : styles.govButton), ...(active ? styles.govButtonActive : {}) }}>
      {children}
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
  shell: { display: 'grid', gap: 12 },
  searchRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
  },
  fieldButton: {
    alignItems: 'stretch',
    background: '#0f172a',
    border: '1px solid #30405f',
    borderRadius: 14,
    color: '#f8fafc',
    cursor: 'pointer',
    display: 'grid',
    gap: 8,
    minHeight: 76,
    padding: '12px 14px',
    textAlign: 'inherit',
  },
  fieldButtonActive: {
    background: '#172554',
    borderColor: '#5d73ff',
    boxShadow: '0 0 0 1px rgba(93, 115, 255, .3)',
  },
  fieldLabel: { color: '#9ca3af', fontSize: 12, fontWeight: 900 },
  fieldValue: { color: '#fff', fontSize: 16, fontWeight: 950, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  govPanel: {
    background: '#0b1220',
    border: '1px solid #26324a',
    borderRadius: 16,
    display: 'grid',
    gap: 10,
    padding: 12,
  },
  govPanelLabel: { color: '#d9b800', fontSize: 12, fontWeight: 950 },
  govGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))', gap: 8 },
  areaGrid: { display: 'grid', gap: 8, gridAutoFlow: 'column', gridAutoColumns: 'minmax(132px, 1fr)', overflowX: 'auto', paddingBottom: 4 },
  govButton: {
    background: '#111827',
    border: '1px solid #30384d',
    borderRadius: 12,
    color: '#f8fafc',
    cursor: 'pointer',
    fontWeight: 900,
    minHeight: 42,
    padding: '8px 10px',
  },
  govButtonActive: {
    background: '#3347b8',
    borderColor: '#6d82ff',
    color: '#fff',
  },
  areaButton: {
    background: '#111827',
    border: '1px solid #30384d',
    borderRadius: 12,
    color: '#f8fafc',
    cursor: 'pointer',
    fontWeight: 900,
    minHeight: 42,
    padding: '8px 10px',
    whiteSpace: 'nowrap',
  },
}
