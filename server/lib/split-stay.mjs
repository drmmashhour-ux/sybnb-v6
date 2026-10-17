// Split-stay planner (pure, no database). When no single listing is free for the whole range, find
// pairs of listings that together cover it: listing A for the first k nights, listing B for the
// remaining n-k nights (back to back, B checks in the day A checks out).
//
// `free` maps listingId -> Set of free night strings (YYYY-MM-DD). `nights` is the ordered list of
// the requested night strings. Each leg is at least `minLegNights` long when the stay allows it.

export function longestFreePrefix(nights, freeSet) {
  let n = 0
  while (n < nights.length && freeSet.has(nights[n])) n += 1
  return n
}

export function longestFreeSuffix(nights, freeSet) {
  let n = 0
  while (n < nights.length && freeSet.has(nights[nights.length - 1 - n])) n += 1
  return n
}

// listings: [{ id, priceMinor }]; returns { singles: [id], pairs: [{ firstId, secondId, firstNights, secondNights, estimateMinor }] }
export function planSplitStays(nights, listings, free, { minLegNights = 2, maxPairs = 5 } = {}) {
  const total = nights.length
  const singles = listings.filter((l) => longestFreePrefix(nights, free.get(l.id) || new Set()) === total).map((l) => l.id)
  if (singles.length || total < 2) return { singles, pairs: [] }

  const minLeg = total >= minLegNights * 2 ? minLegNights : 1
  const prefix = new Map(listings.map((l) => [l.id, longestFreePrefix(nights, free.get(l.id) || new Set())]))
  const suffix = new Map(listings.map((l) => [l.id, longestFreeSuffix(nights, free.get(l.id) || new Set())]))
  const pairs = []
  for (const a of listings) {
    const pa = prefix.get(a.id)
    if (pa < minLeg) continue
    for (const b of listings) {
      if (b.id === a.id) continue
      const sb = suffix.get(b.id)
      if (sb < minLeg || pa + sb < total) continue
      // Valid split points k satisfy total - sb <= k <= pa, with both legs >= minLeg.
      const lo = Math.max(total - sb, minLeg)
      const hi = Math.min(pa, total - minLeg)
      if (lo > hi) continue
      const k = hi // give the first listing as many nights as possible; the exact split is shown to the guest
      pairs.push({
        firstId: a.id,
        secondId: b.id,
        firstNights: k,
        secondNights: total - k,
        estimateMinor: a.priceMinor * k + b.priceMinor * (total - k),
      })
    }
  }
  pairs.sort((x, y) => x.estimateMinor - y.estimateMinor)
  return { singles, pairs: pairs.slice(0, maxPairs) }
}

export function nightsBetween(checkInIso, checkOutIso) {
  const out = []
  const end = Date.parse(`${checkOutIso}T00:00:00.000Z`)
  for (let t = Date.parse(`${checkInIso}T00:00:00.000Z`); t < end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}
