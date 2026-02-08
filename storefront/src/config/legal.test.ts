import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it } from "vitest"

import { LEGAL_EFFECTIVE_DATE, legalConfig, legalRoutes } from "@/config/legal"

describe("legal config", () => {
  beforeEach(() => {
    faker.seed(9902)
  })

  it("exposes required legal routes", () => {
    const routeEntries = Object.entries(legalRoutes)
    const randomEntry = faker.helpers.arrayElement(routeEntries)

    expect(routeEntries).toEqual(
      expect.arrayContaining([
        ["terms", "/terms"],
        ["privacy", "/privacy"],
        ["shipping", "/shipping"],
        ["returns", "/returns"],
        ["accessibility", "/accessibility"],
        ["cookies", "/cookies"],
        ["contact", "/contact"],
      ])
    )
    expect(randomEntry[1]).toMatch(/^\/[a-z-]+$/)
  })

  it("contains operational policy values", () => {
    expect(LEGAL_EFFECTIVE_DATE).toBe("February 8, 2026")
    expect(legalConfig.businessName.length).toBeGreaterThanOrEqual(5)
    expect(legalConfig.supportEmail).toMatch(/@/)
    expect(legalConfig.shipping.processingWindow).toContain("business")
    expect(legalConfig.returns.windowDays).toBeGreaterThan(faker.number.int({ min: 10, max: 20 }))
    expect(legalConfig.privacy.processors.length).toBeGreaterThanOrEqual(3)
  })
})

