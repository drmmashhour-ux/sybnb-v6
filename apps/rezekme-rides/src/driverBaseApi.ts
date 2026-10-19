import { getStoredStaffSession } from '@platform/shared/api/platformApi'

/**
 * Client for the shared driver base (server/routes/driver-base.mjs): application checklist, car facts,
 * documents with expiry dates, car-care log and the key code. Same bearer token as the rest of the
 * driver screen (the DRIVER staff session). Nothing about fares or commission lives here.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3051'

export type DocKind =
  | 'LICENCE' | 'REGISTRATION' | 'INSURANCE' | 'CRIMINAL_RECORD' | 'MECHANIC_REPORT' | 'EXPERIENCE'
  | 'CAR_PHOTO_FRONT' | 'CAR_PHOTO_BACK' | 'CAR_PHOTO_LEFT' | 'CAR_PHOTO_RIGHT' | 'CAR_PHOTO_INSIDE' | 'CAR_PHOTO_BOOT'

export type DriverDoc = { kind: DocKind; status: 'IN_REVIEW' | 'APPROVED' | 'REJECTED'; adminNote?: string | null; expiresAt?: string | null }
export type DutyBlocker = { kind: DocKind; reason: 'MISSING' | 'REJECTED' | 'IN_REVIEW' | 'EXPIRED' }
export type CarFacts = {
  largeBagCapacity: number | null; handBagCapacity: number | null; seatCount: number | null
  smokingAllowed: boolean; tyreType: 'WINTER' | 'ALL_SEASON' | null; tyresFittedOn: string | null
}
export type DriverBase = {
  vehicleStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null
  hasKeyCode: boolean
  onDutyAt: string | null
  carFacts: CarFacts | null
  documents: DriverDoc[]
  missingDocuments: DocKind[]
  dutyBlockers: DutyBlocker[]
  expiringSoon: Array<{ kind: DocKind; days: number }>
  carCare: { OUTSIDE: { lastDoneAt: string | null; due: boolean }; INSIDE: { lastDoneAt: string | null; due: boolean } }
  rating: { averageRating: number | null; ratingCount: number }
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = getStoredStaffSession('DRIVER')?.token
  if (!token) throw new Error('Sign in as a driver to continue.')
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = (await response.json()) as { ok?: boolean; error?: { message?: string; code?: string } } & T
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error?.message || `Request failed: ${response.status}`) as Error & { code?: string }
    if (payload?.error?.code) error.code = payload.error.code
    throw error
  }
  return payload
}

export const fetchDriverBase = () => call<{ ok: true } & DriverBase>('/api/driver/base')
export const logCarCare = (kind: 'OUTSIDE' | 'INSIDE') => call<{ ok: true; carCare: DriverBase['carCare'] }>('/api/driver/car-care', 'POST', { kind })
export const verifyKeyCode = (code: string) => call<{ ok: true }>('/api/driver/key-code/verify', 'POST', { code })
export const uploadDriverDocument = (kind: DocKind, fileBase64: string, mimeType: string, expiresAt?: string) =>
  call<{ ok: true }>(`/api/driver/documents/${kind}`, 'PUT', { fileBase64, mimeType, expiresAt: expiresAt || undefined })
export const fetchDriverVehicle = () => call<{ ok: true; driverProfile: Record<string, unknown> | null }>('/api/driver/vehicle')
export const saveVehicleAndFacts = (body: Record<string, unknown>) => call<{ ok: true }>('/api/driver/vehicle', 'PUT', body)

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(file)
  })
}
