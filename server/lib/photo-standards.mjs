// Menu Studio photo standards (2026-10-15).
//
// Every food photo must pass these checks BEFORE it is stored, and the evidence is persisted in
// photo_meta for the human reviewer. Honest scope note: software cannot reliably prove a photo is
// "not photoshopped" — what we CAN do, and do here, is:
//   1. Enforce hard standards automatically (real decodable image, minimum resolution, sane
//      aspect ratio, size limits) — these fail the upload outright.
//   2. Flag editing-software signatures (Photoshop/GIMP/Canva/... markers left in the file) as
//      evidence for the ADMIN review queue — the human reviewer makes the authenticity call.
// Nothing becomes customer-visible until an admin APPROVES it (fail-closed), so the guarantee
// customers get is "reviewed", enforced by the queue, not by a heuristic.
//
// Pure Node, no dependencies: dimensions are parsed straight from JPEG/PNG/WebP headers.

const MIN_WIDTH = 640
const MIN_HEIGHT = 480
const MAX_SIDE = 8000
// Aspect gate: menu/cover photos must be usable in a card layout — reject extreme strips.
const MAX_ASPECT = 2.5

// Byte signatures of common editing/compositing software left in EXIF "Software", XMP
// "CreatorTool", or Photoshop APP13 blocks. A match does NOT reject the upload — it flags it
// for the reviewer (photoMeta.editorSignature).
const EDITOR_SIGNATURES = ['Adobe Photoshop', 'Photoshop', 'Adobe Lightroom', 'Lightroom', 'GIMP', 'Canva', 'Pixelmator', 'Affinity Photo', 'paint.net', 'PicsArt', 'Fotor', 'Luminar', 'CorelDRAW', 'Adobe Illustrator']

function standardsError(code, message, meta) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  if (meta) error.meta = meta
  return error
}

function readUInt24LE(buf, off) {
  return buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16)
}

// --- Dimension parsers (header-level, no full decode) ---
function jpegDimensions(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue }
    const marker = buf[i + 1]
    // Standalone markers without a length segment.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01 || marker === 0xff) { i += 2; continue }
    const len = (buf[i + 2] << 8) | buf[i + 3]
    if (len < 2) return null
    // SOF0..SOF15 (minus DHT/JPG/DAC at C4/C8/CC) carry the frame dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (buf[i + 5] << 8) | buf[i + 6]
      const width = (buf[i + 7] << 8) | buf[i + 8]
      return { width, height }
    }
    i += 2 + len
  }
  return null
}

function pngDimensions(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (buf.length < 24) return null
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null
  // IHDR is required to be the first chunk: width/height at fixed offsets 16/20.
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function webpDimensions(buf) {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null
  const fourcc = buf.toString('latin1', 12, 16)
  if (fourcc === 'VP8X') {
    return { width: 1 + readUInt24LE(buf, 24), height: 1 + readUInt24LE(buf, 27) }
  }
  if (fourcc === 'VP8 ') {
    // Lossy: 3-byte frame tag, then sync 9D 01 2A, then 14-bit width/height (LE).
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  }
  if (fourcc === 'VP8L') {
    if (buf[20] !== 0x2f) return null
    const bits = buf.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}

export function imageDimensions(buf, mimeType) {
  if (mimeType === 'image/jpeg') return jpegDimensions(buf)
  if (mimeType === 'image/png') return pngDimensions(buf)
  if (mimeType === 'image/webp') return webpDimensions(buf)
  return null
}

// Scan the first 256KB (where EXIF/XMP/APP13 metadata lives) for editor signatures.
export function detectEditorSignature(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 256 * 1024)).toString('latin1')
  for (const sig of EDITOR_SIGNATURES) {
    if (head.includes(sig)) return sig
  }
  return null
}

// Validates the upload against the hard standards (throws 400 PHOTO_* on failure) and returns the
// photo_meta evidence object for the review queue. Never throws on the editor heuristic — that is
// the human reviewer's call.
export function checkPhotoStandards(base64Data, mimeType) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw standardsError('PHOTO_TYPE_INVALID', 'Photos must be JPEG, PNG or WebP.')
  }
  const bytes = Buffer.from(base64Data || '', 'base64')
  if (!bytes.length) throw standardsError('PHOTO_EMPTY', 'The uploaded photo is empty.')

  const dims = imageDimensions(bytes, mimeType)
  if (!dims || !dims.width || !dims.height) {
    throw standardsError('PHOTO_UNREADABLE', 'The file does not look like a valid photo of that type.')
  }
  if (dims.width < MIN_WIDTH || dims.height < MIN_HEIGHT) {
    throw standardsError(
      'PHOTO_TOO_SMALL',
      `Photos must be at least ${MIN_WIDTH}×${MIN_HEIGHT}px (this one is ${dims.width}×${dims.height}).`,
      { width: dims.width, height: dims.height, minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT },
    )
  }
  if (dims.width > MAX_SIDE || dims.height > MAX_SIDE) {
    throw standardsError('PHOTO_TOO_LARGE_DIMENSIONS', `Photos must be at most ${MAX_SIDE}px on a side.`)
  }
  const aspect = dims.width / dims.height
  if (aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT) {
    throw standardsError('PHOTO_ASPECT_INVALID', 'Photo proportions are too extreme for a menu card. Use a roughly rectangular photo.')
  }

  const editorSignature = detectEditorSignature(bytes)
  return {
    width: dims.width,
    height: dims.height,
    bytes: bytes.length,
    format: mimeType,
    editorSignature, // null = no known editor marker found; a string = reviewer should look closely
    standardsVersion: 1,
    checkedAt: new Date().toISOString(),
  }
}
