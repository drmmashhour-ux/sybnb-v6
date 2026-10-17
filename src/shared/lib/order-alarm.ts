// Kitchen alarm for the restaurant dashboard. Browsers only allow sound after a user tap, so the
// restaurant taps "Start taking orders" once per shift; after that the alarm rings (every few
// seconds) for as long as any order is still waiting for accept/reject, and the screen is kept awake.

export function pendingOrderCount(orders: ReadonlyArray<{ status?: string }>): number {
  return orders.filter((o) => o.status === 'PLACED').length
}

export function shouldRing(enabled: boolean, orders: ReadonlyArray<{ status?: string }>): boolean {
  return enabled && pendingOrderCount(orders) > 0
}

type AudioCtor = typeof AudioContext

export function createOrderAlarm() {
  let ctx: AudioContext | null = null
  let timer: number | null = null
  let wake: { release: () => Promise<void> } | null = null

  function beep() {
    if (!ctx) return
    try {
      for (let i = 0; i < 3; i += 1) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'square'
        osc.frequency.value = i % 2 === 0 ? 880 : 1175
        gain.gain.value = 0.9
        osc.connect(gain)
        gain.connect(ctx.destination)
        const t0 = ctx.currentTime + i * 0.22
        osc.start(t0)
        osc.stop(t0 + 0.16)
      }
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([200, 100, 200])
    } catch { /* sound is best-effort */ }
  }

  async function requestWake() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
      if (nav.wakeLock && !wake) wake = await nav.wakeLock.request('screen')
    } catch { wake = null }
  }

  return {
    /** Must be called from a tap handler. Returns false if the browser has no audio. */
    async enable(): Promise<boolean> {
      const Ctor: AudioCtor | undefined = typeof window !== 'undefined'
        ? (window.AudioContext || (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext)
        : undefined
      if (!Ctor) return false
      if (!ctx) ctx = new Ctor()
      try { await ctx.resume() } catch { /* ignore */ }
      beep() // confirms to the owner that sound works
      await requestWake()
      return true
    },
    /** Re-acquire the wake lock after the tab becomes visible again (browsers drop it when hidden). */
    async reacquire() { wake = null; await requestWake() },
    ring(on: boolean) {
      if (on && timer === null) { beep(); timer = window.setInterval(beep, 4000) }
      if (!on && timer !== null) { window.clearInterval(timer); timer = null }
    },
    async disable() {
      if (timer !== null) { window.clearInterval(timer); timer = null }
      try { await wake?.release() } catch { /* ignore */ }
      wake = null
      try { await ctx?.close() } catch { /* ignore */ }
      ctx = null
    },
  }
}
