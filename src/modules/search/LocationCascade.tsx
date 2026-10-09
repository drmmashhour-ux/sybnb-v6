import { useState, type ReactNode } from 'react'
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
  // The compact search bar owns which popover is open (only one at a time).
  open: boolean
  onOpenChange: (open: boolean) => void
}

const T = {
  ar: {
    where: 'الوجهة',
    governorate: 'المحافظة',
    city: 'المدينة',
    area: 'المنطقة',
    optional: 'اختياري',
    allSyria: 'كل سوريا',
    done: 'تم',
  },
  en: {
    where: 'Where',
    governorate: 'Governorate',
    city: 'City',
    area: 'Area',
    optional: 'optional',
    allSyria: 'All of Syria',
    done: 'Done',
  },
  fr: {
    where: 'Destination',
    governorate: 'Gouvernorat',
    city: 'Ville',
    area: 'Quartier',
    optional: 'facultatif',
    allSyria: 'Toute la Syrie',
    done: 'OK',
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

type Step = 'governorate' | 'city' | 'area'

// Compact "Where" pill: the governorate is the main choice; city and area are optional refinements
// offered inside the same popover once a governorate is chosen.
export function LocationCascade({ lang, value, onChange, onClear, open, onOpenChange }: LocationCascadeProps) {
  const [step, setStep] = useState<Step>('governorate')
  const governorate = getGovernorate(value.governorate)
  const city = getCity(value.governorate, value.city)
  const area = city?.areas.find((item) => item.key === value.area)
  const t = T[lang]
  const displayLabel = (item?: { key?: string; ar: string; en: string }) => {
    if (!item) return ''
    return lang === 'ar' && item.key && AR_LABEL_OVERRIDES[item.key] ? AR_LABEL_OVERRIDES[item.key] : labelFor(lang, item)
  }
  const selectGovernorate = (key: string) => {
    const nextGovernorate = getGovernorate(key)
    onChange({ governorate: key, city: nextGovernorate?.cities[0]?.key || '', area: '' })
    setStep('city')
  }
  const selectCity = (key: string) => {
    onChange({ ...value, city: key, area: '' })
    setStep('area')
  }
  const selectArea = (key: string) => {
    onChange({ ...value, area: key })
    onOpenChange(false)
  }

  const summary = [
    displayLabel(governorate),
    city && displayLabel(city) !== displayLabel(governorate) ? displayLabel(city) : '',
    displayLabel(area),
  ].filter(Boolean).join(' · ') || t.allSyria

  const toggle = () => {
    if (!open) setStep('governorate')
    onOpenChange(!open)
  }

  return (
    <div className="usb-slot usb-slot-where">
      <button type="button" className={`usb-pill${open ? ' is-open' : ''}`} onClick={toggle} aria-expanded={open}>
        <span className="usb-pill-label">{t.where}</span>
        <strong className="usb-pill-value">{summary}</strong>
      </button>

      {open && (
        <div className="usb-pop usb-pop-where" role="dialog" aria-label={t.where}>
          <div className="usb-steps">
            <StepChip active={step === 'governorate'} onClick={() => setStep('governorate')}>
              {t.governorate}
            </StepChip>
            <StepChip active={step === 'city'} disabled={!governorate} onClick={() => setStep('city')}>
              {t.city} <small>({t.optional})</small>
            </StepChip>
            <StepChip active={step === 'area'} disabled={!city} onClick={() => setStep('area')}>
              {t.area} <small>({t.optional})</small>
            </StepChip>
          </div>

          <div className="usb-choice-grid">
            {step === 'governorate' && (
              <>
                {onClear ? (
                  <ChoiceButton active={!value.governorate} onClick={() => { onClear(); onOpenChange(false) }}>
                    {t.allSyria}
                  </ChoiceButton>
                ) : null}
                {SYRIA_GOVERNORATES.map((item) => (
                  <ChoiceButton key={item.key} active={item.key === value.governorate} onClick={() => selectGovernorate(item.key)}>
                    {displayLabel(item)}
                  </ChoiceButton>
                ))}
              </>
            )}
            {step === 'city' && governorate?.cities.map((item) => (
              <ChoiceButton key={item.key} active={item.key === value.city} onClick={() => selectCity(item.key)}>
                {displayLabel(item)}
              </ChoiceButton>
            ))}
            {step === 'area' && city?.areas.slice(0, 36).map((item) => (
              <ChoiceButton key={item.key} active={item.key === value.area} onClick={() => selectArea(item.key)}>
                {displayLabel(item)}
              </ChoiceButton>
            ))}
          </div>

          <div className="usb-pop-actions">
            <button type="button" className="usb-pop-done" onClick={() => onOpenChange(false)}>{t.done}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function StepChip({ active, disabled = false, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`usb-step${active ? ' is-active' : ''}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

function ChoiceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`usb-choice${active ? ' is-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}
