import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it } from "vitest"

import {
  COOKIE_PREFERENCES_COOKIE_NAME,
  COOKIE_PREFERENCES_MAX_AGE_SECONDS,
  COOKIE_PREFERENCES_VERSION,
  buildCookiePreferences,
  buildCookiePreferencesHeader,
  extractCookieValue,
  getDefaultCookiePreferences,
  parseCookiePreferences,
  parseCookiePreferencesFromHeader,
  serializeCookiePreferences,
} from "@/lib/legal/cookie-consent"

describe("cookie consent utilities", () => {
  beforeEach(() => {
    faker.seed(8811)
  })

  it("builds default preferences with necessary-only enabled", () => {
    const preferences = getDefaultCookiePreferences()

    expect(preferences).toMatchObject({
      necessary: true,
      analytics: false,
      marketing: false,
      version: COOKIE_PREFERENCES_VERSION,
    })
    expect(new Date(preferences.updatedAt).toISOString()).toBe(preferences.updatedAt)
  })

  it("builds custom preferences with deterministic timestamp", () => {
    const now = faker.date.between({
      from: "2025-01-01T00:00:00.000Z",
      to: "2026-12-31T23:59:59.999Z",
    })
    const analytics = faker.datatype.boolean()
    const marketing = faker.datatype.boolean()

    const preferences = buildCookiePreferences({ analytics, marketing }, now)

    expect(preferences).toEqual({
      necessary: true,
      analytics,
      marketing,
      version: COOKIE_PREFERENCES_VERSION,
      updatedAt: now.toISOString(),
    })
  })

  it("serializes and parses encoded preference payloads", () => {
    const preferences = buildCookiePreferences(
      {
        analytics: true,
        marketing: faker.datatype.boolean(),
      },
      faker.date.recent()
    )

    const encoded = serializeCookiePreferences(preferences)
    expect(parseCookiePreferences(encoded)).toEqual(preferences)
  })

  it("parses plain json payloads and normalizes malformed fields", () => {
    const randomDate = faker.date.soon().toISOString()
    const raw = JSON.stringify({
      analytics: "yes",
      marketing: true,
      version: "bad-version",
      updatedAt: randomDate,
    })

    const parsed = parseCookiePreferences(raw)

    expect(parsed).toEqual({
      necessary: true,
      analytics: false,
      marketing: true,
      version: COOKIE_PREFERENCES_VERSION,
      updatedAt: randomDate,
    })
  })

  it("builds cookie headers with secure defaults and parses back from header", () => {
    const preferences = buildCookiePreferences(
      {
        analytics: faker.datatype.boolean(),
        marketing: faker.datatype.boolean(),
      },
      faker.date.recent()
    )

    const header = buildCookiePreferencesHeader(preferences)

    expect(header).toContain(`${COOKIE_PREFERENCES_COOKIE_NAME}=`)
    expect(header).toContain(`Max-Age=${COOKIE_PREFERENCES_MAX_AGE_SECONDS}`)
    expect(header).toContain("Path=/")
    expect(header).toContain("SameSite=Lax")
    expect(header).toContain("Secure")

    expect(parseCookiePreferencesFromHeader(header)).toEqual(preferences)
  })

  it("extracts named cookies from mixed cookie headers", () => {
    const cookieName = faker.word.sample()
    const cookieValue = faker.string.alphanumeric(faker.number.int({ min: 12, max: 24 }))
    const header = [
      `${faker.word.sample()}=${faker.string.alphanumeric(8)}`,
      `${cookieName}=${cookieValue}`,
      `${faker.word.sample()}=${faker.string.alphanumeric(8)}`,
    ].join("; ")

    expect(extractCookieValue(header, cookieName)).toBe(cookieValue)
  })

  it("returns null for empty or invalid cookie preference values", () => {
    expect(parseCookiePreferences("")).toBeNull()
    expect(parseCookiePreferences(faker.string.alpha({ length: 16 }))).toBeNull()
    expect(parseCookiePreferencesFromHeader(undefined)).toBeNull()
    expect(
      extractCookieValue(
        `${faker.word.sample()}=${faker.string.alphanumeric(8)}`,
        COOKIE_PREFERENCES_COOKIE_NAME
      )
    ).toBeNull()
  })
})

