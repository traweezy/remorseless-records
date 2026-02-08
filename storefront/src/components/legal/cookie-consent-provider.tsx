"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import {
  COOKIE_PREFERENCES_STORAGE_KEY,
  buildCookiePreferences,
  buildCookiePreferencesHeader,
  getDefaultCookiePreferences,
  parseCookiePreferences,
  parseCookiePreferencesFromHeader,
  type CookiePreferenceSelection,
  type CookiePreferences,
} from "@/lib/legal/cookie-consent"

type CookieConsentContextValue = {
  isHydrated: boolean
  hasStoredPreferences: boolean
  preferences: CookiePreferences
  acceptAll: () => void
  rejectNonEssential: () => void
  saveSelection: (selection: CookiePreferenceSelection) => void
}

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null)

type CookieConsentProviderProps = {
  children: ReactNode
}

type CookieConsentSnapshot = {
  isHydrated: boolean
  hasStoredPreferences: boolean
  preferences: CookiePreferences
}

const COOKIE_CONSENT_EVENT = "rr:cookie-consent-updated"

const loadStoredPreferences = (): CookiePreferences | null => {
  if (typeof window === "undefined") {
    return null
  }

  const fromCookie = parseCookiePreferencesFromHeader(document.cookie)
  if (fromCookie) {
    return fromCookie
  }

  const fromLocalStorage = parseCookiePreferences(window.localStorage.getItem(COOKIE_PREFERENCES_STORAGE_KEY))
  if (fromLocalStorage) {
    return fromLocalStorage
  }

  return null
}

const SERVER_SNAPSHOT: CookieConsentSnapshot = {
  isHydrated: false,
  hasStoredPreferences: false,
  preferences: getDefaultCookiePreferences(),
}

let cachedSnapshot: CookieConsentSnapshot = SERVER_SNAPSHOT

const areSnapshotsEqual = (
  left: CookieConsentSnapshot,
  right: CookieConsentSnapshot
): boolean =>
  left.isHydrated === right.isHydrated &&
  left.hasStoredPreferences === right.hasStoredPreferences &&
  left.preferences.analytics === right.preferences.analytics &&
  left.preferences.marketing === right.preferences.marketing &&
  left.preferences.necessary === right.preferences.necessary &&
  left.preferences.updatedAt === right.preferences.updatedAt &&
  left.preferences.version === right.preferences.version

const getSnapshot = (): CookieConsentSnapshot => {
  if (typeof window === "undefined") {
    return SERVER_SNAPSHOT
  }

  const stored = loadStoredPreferences()
  const nextSnapshot: CookieConsentSnapshot = {
    isHydrated: true,
    hasStoredPreferences: Boolean(stored),
    preferences: stored ?? getDefaultCookiePreferences(),
  }

  if (areSnapshotsEqual(cachedSnapshot, nextSnapshot)) {
    return cachedSnapshot
  }

  cachedSnapshot = nextSnapshot
  return cachedSnapshot
}

const subscribeToCookieConsent = (onStoreChange: () => void): (() => void) => {
  if (typeof window === "undefined") {
    return () => {}
  }

  const handleChange = () => {
    onStoreChange()
  }

  window.addEventListener("storage", handleChange)
  window.addEventListener(COOKIE_CONSENT_EVENT, handleChange)

  return () => {
    window.removeEventListener("storage", handleChange)
    window.removeEventListener(COOKIE_CONSENT_EVENT, handleChange)
  }
}

export const CookieConsentProvider = ({ children }: CookieConsentProviderProps) => {
  const snapshot = useSyncExternalStore(
    subscribeToCookieConsent,
    getSnapshot,
    () => SERVER_SNAPSHOT
  )

  const persistPreferences = useCallback((next: CookiePreferences) => {
    if (typeof window === "undefined") {
      return
    }

    const secure = window.location.protocol === "https:"
    document.cookie = buildCookiePreferencesHeader(next, { secure })
    window.localStorage.setItem(COOKIE_PREFERENCES_STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event(COOKIE_CONSENT_EVENT))
  }, [])

  const acceptAll = useCallback(() => {
    persistPreferences(buildCookiePreferences({ analytics: true, marketing: true }))
  }, [persistPreferences])

  const rejectNonEssential = useCallback(() => {
    persistPreferences(buildCookiePreferences({ analytics: false, marketing: false }))
  }, [persistPreferences])

  const saveSelection = useCallback(
    (selection: CookiePreferenceSelection) => {
      persistPreferences(buildCookiePreferences(selection))
    },
    [persistPreferences]
  )

  const value = useMemo(
    () => ({
      isHydrated: snapshot.isHydrated,
      hasStoredPreferences: snapshot.hasStoredPreferences,
      preferences: snapshot.preferences,
      acceptAll,
      rejectNonEssential,
      saveSelection,
    }),
    [acceptAll, rejectNonEssential, saveSelection, snapshot]
  )

  return <CookieConsentContext.Provider value={value}>{children}</CookieConsentContext.Provider>
}

export const useCookieConsent = (): CookieConsentContextValue => {
  const context = useContext(CookieConsentContext)
  if (!context) {
    throw new Error("useCookieConsent must be used within CookieConsentProvider")
  }
  return context
}
