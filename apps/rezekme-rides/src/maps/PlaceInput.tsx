import type { CSSProperties } from 'react'
import type { LatLng } from './mapTypes'

export type PlaceSelection = { text: string; point: LatLng }

type Props = {
  value: string
  onTextChange: (text: string) => void
  /** Kept for the caller's API; with no paid geocoder nothing fires it (addresses are typed, pins come from the map or saved places). */
  onPlace: (selection: PlaceSelection) => void
  lang: string
  placeholder?: string
  ariaLabel?: string
  style?: CSSProperties
}

/** Plain controlled address input. Coordinates come from the map pin, GPS or a saved place. */
export function PlaceInput({ value, onTextChange, placeholder, ariaLabel, style }: Props) {
  return <input style={style} aria-label={ariaLabel} placeholder={placeholder} value={value} autoComplete="off" onChange={(event) => onTextChange(event.target.value)} />
}
