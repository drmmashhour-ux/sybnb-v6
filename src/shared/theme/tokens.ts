export const colors = {
  ink: '#f7f8ff',
  text: '#f7f8ff',
  muted: '#9aa7bd',
  dim: '#8592ad', // WCAG AA: >=4.6:1 on all app backgrounds (was #68758d = 3.35-4.11:1, failed AA)
  bg: '#0a0f1d',
  bg2: '#101827',
  panel: '#121c2f',
  panel2: '#17243a',
  line: '#263651',
  blue: '#526cff',
  cyan: '#19d7ff',
  gold: '#d5a915',
  green: '#20d29b',
  red: '#ff5c7a',
  violet: '#7c35ff',
}

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
}

export function withAlpha(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const bigint = parseInt(value, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
