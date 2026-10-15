import { useEffect, useRef, type CSSProperties } from 'react'
import { hasGoogleMapsKey, loadGoogleMaps, mapsCountry } from './googleLoader'
import type { LatLng } from './mapTypes'

export type PlaceSelection = { text: string; point: LatLng }

type Props = {
  value: string
  onTextChange: (text: string) => void
  /** Fired when the rider picks a Places suggestion that carries coordinates. */
  onPlace: (selection: PlaceSelection) => void
  lang: string
  placeholder?: string
  ariaLabel?: string
  style?: CSSProperties
}

/**
 * Text input that gains Google Places Autocomplete when a key is configured and the script loads.
 * Without a key (or if Google fails) it stays a plain controlled text input, so the existing manual
 * address flow is untouched. A suggestion sets the text AND the coordinates (via onPlace).
 */
export function PlaceInput({ value, onTextChange, onPlace, lang, placeholder, ariaLabel, style }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const onPlaceRef = useRef(onPlace)
  onPlaceRef.current = onPlace

  useEffect(() => {
    if (!hasGoogleMapsKey || !inputRef.current) return
    let disposed = false
    let listener: { remove?: () => void } | null = null
    loadGoogleMaps(lang)
      .then((g) => {
        if (disposed || !inputRef.current) return
        const autocomplete = new g.maps.places.Autocomplete(inputRef.current, {
          fields: ['geometry', 'formatted_address', 'name'],
          ...(mapsCountry ? { componentRestrictions: { country: mapsCountry } } : {}),
        })
        listener = autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace()
          const location = place?.geometry?.location
          if (!location) return // free text submitted without choosing a suggestion: stays manual
          const point = { lat: location.lat() as number, lng: location.lng() as number }
          const text = String(place.formatted_address || place.name || inputRef.current?.value || '').trim()
          if (!text) return
          onPlaceRef.current({ text, point })
        })
      })
      .catch(() => {
        /* Google unavailable: plain input */
      })
    return () => {
      disposed = true
      listener?.remove?.()
    }
  }, [lang])

  return (
    <input
      ref={inputRef}
      style={style}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      autoComplete="off"
      onChange={(event) => onTextChange(event.target.value)}
    />
  )
}
