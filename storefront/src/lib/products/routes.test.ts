import { describe, expect, it } from "vitest"

import {
  buildInternalHandleCandidates,
  buildPublicProductPath,
  resolvePublicProductRouteType,
} from "@/lib/products/routes"

describe("product routes", () => {
  it.each([
    ["music-release-aberratio-thanatos", "/music-release/aberratio-thanatos"],
    ["fixed-bundle-death-thrash-attack", "/bundle/death-thrash-attack"],
    ["mystery-bundle-mystery-bundle", "/bundle/mystery-bundle"],
    [
      "merch-remorseless-records-logo-button",
      "/merch/remorseless-records-logo-button",
    ],
  ])("maps %s to its public route", (handle, expected) => {
    expect(buildPublicProductPath({ handle })).toBe(expected)
  })

  it("preserves an unknown legacy handle", () => {
    expect(buildPublicProductPath({ handle: "legacy-handle" })).toBe(
      "/products/legacy-handle"
    )
  })

  it("recognizes normalized product type labels", () => {
    expect(
      resolvePublicProductRouteType({ productType: "Music release" })
    ).toBe("music-release")
    expect(resolvePublicProductRouteType({ productType: "Fixed bundle" })).toBe(
      "bundle"
    )
  })

  it("tries fixed before mystery bundle handles", () => {
    expect(buildInternalHandleCandidates("bundle", "mystery-bundle")).toEqual([
      "fixed-bundle-mystery-bundle",
      "mystery-bundle-mystery-bundle",
    ])
  })
})
