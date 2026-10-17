// Client-side photo optimisation: resize to a sane maximum, re-encode as WebP (which also strips
// EXIF/GPS metadata and bakes in the camera orientation) before upload. Large phone photos are
// 5-20 MB; on mobile data that is the slowest part of listing creation and of every later page
// view. Falls back to the untouched original on any failure, and never returns a bigger file.
// Not used for ID documents or payment proofs: those must be stored exactly as submitted.

const MAX_EDGE = 1600
const QUALITY = 0.82

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

export async function optimizePhoto(file: File): Promise<{ base64: string; mimeType: string }> {
  const original = async () => ({ base64: await toBase64(file), mimeType: file.type })
  try {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return await original()
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return await original()
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY))
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return await original()
    return { base64: await toBase64(blob), mimeType: 'image/webp' }
  } catch {
    return await original()
  }
}
