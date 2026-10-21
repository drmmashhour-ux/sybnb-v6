/** Keyless vector tiles (OpenStreetMap data served by OpenFreeMap): no account, no key, no billing. */
export const MAP_STYLE_URL = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined)?.trim() || 'https://tiles.openfreemap.org/styles/liberty'

export function pinEl(kind: 'pickup' | 'dropoff' | 'stop' | 'user' | 'start' | 'end', label?: string): HTMLDivElement {
  const el = document.createElement('div')
  const base = 'box-sizing:border-box;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);'
  const css: Record<string, string> = {
    pickup: 'width:18px;height:18px;border-radius:50%;background:#000;',
    dropoff: 'width:18px;height:18px;background:#000;',
    stop: 'width:22px;height:22px;border-radius:50%;background:#6b6b6b;color:#fff;font:700 11px/16px system-ui;text-align:center;',
    user: 'width:16px;height:16px;border-radius:50%;background:#276ef1;',
    start: 'width:16px;height:16px;border-radius:50%;background:#1a7f37;',
    end: 'width:16px;height:16px;border-radius:50%;background:#b00020;',
  }
  el.style.cssText = base + css[kind]
  if (label) el.textContent = label
  return el
}
