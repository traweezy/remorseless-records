export const COOKIE_PREFERENCES_COOKIE_NAME = "rr_cookie_preferences"
export const COOKIE_PREFERENCES_STORAGE_KEY = "rr.cookie.preferences"
export const COOKIE_PREFERENCES_VERSION = 1
export const COOKIE_PREFERENCES_MAX_AGE_SECONDS = 60 * 60 * 24 * 180

export type CookiePreferences = {
  necessary: true
  analytics: boolean
  marketing: boolean
  version: number
  updatedAt: string
}

export type CookiePreferenceSelection = {
  analytics: boolean
  marketing: boolean
}

const normalizeBoolean = (value: unknown): boolean => value === true

const toIsoDate = (value: unknown): string => {
  if (typeof value !== "string") {
    return new Date().toISOString()
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString()
  }

  return parsed.toISOString()
}

export const buildCookiePreferences = (
  selection: CookiePreferenceSelection,
  now = new Date()
): CookiePreferences => ({
  necessary: true,
  analytics: normalizeBoolean(selection.analytics),
  marketing: normalizeBoolean(selection.marketing),
  version: COOKIE_PREFERENCES_VERSION,
  updatedAt: now.toISOString(),
})

export const getDefaultCookiePreferences = (): CookiePreferences =>
  buildCookiePreferences({ analytics: false, marketing: false })

export const serializeCookiePreferences = (preferences: CookiePreferences): string =>
  encodeURIComponent(JSON.stringify(preferences))

const tryParseCookiePreferences = (
  value: string | null | undefined
): CookiePreferences | null => {
  if (!value || !value.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as Partial<CookiePreferences>
    return {
      necessary: true,
      analytics: normalizeBoolean(parsed.analytics),
      marketing: normalizeBoolean(parsed.marketing),
      version:
        typeof parsed.version === "number" && Number.isFinite(parsed.version)
          ? parsed.version
          : COOKIE_PREFERENCES_VERSION,
      updatedAt: toIsoDate(parsed.updatedAt),
    }
  } catch {
    return null
  }
}

export const parseCookiePreferences = (
  value: string | null | undefined
): CookiePreferences | null => {
  if (!value || !value.trim()) {
    return null
  }

  const decoded = decodeURIComponent(value)
  return tryParseCookiePreferences(decoded) ?? tryParseCookiePreferences(value)
}

export const buildCookiePreferencesHeader = (
  preferences: CookiePreferences,
  options?: { secure?: boolean; path?: string; sameSite?: "Lax" | "Strict"; maxAge?: number }
): string => {
  const secure = options?.secure ?? true
  const path = options?.path ?? "/"
  const sameSite = options?.sameSite ?? "Lax"
  const maxAge = options?.maxAge ?? COOKIE_PREFERENCES_MAX_AGE_SECONDS
  const serialized = serializeCookiePreferences(preferences)
  const parts = [
    `${COOKIE_PREFERENCES_COOKIE_NAME}=${serialized}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    `SameSite=${sameSite}`,
  ]

  if (secure) {
    parts.push("Secure")
  }

  return parts.join("; ")
}

export const extractCookieValue = (
  cookieHeader: string | null | undefined,
  name = COOKIE_PREFERENCES_COOKIE_NAME
): string | null => {
  if (!cookieHeader || !cookieHeader.trim()) {
    return null
  }

  const target = `${name}=`
  const cookies = cookieHeader.split(";")
  for (const cookie of cookies) {
    const trimmed = cookie.trim()
    if (trimmed.startsWith(target)) {
      return trimmed.slice(target.length)
    }
  }

  return null
}

export const parseCookiePreferencesFromHeader = (
  cookieHeader: string | null | undefined
): CookiePreferences | null => {
  const raw = extractCookieValue(cookieHeader, COOKIE_PREFERENCES_COOKIE_NAME)
  return parseCookiePreferences(raw)
}

