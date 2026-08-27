import { describe, expect, it } from "vitest"

import { resolveRemoteImagePatterns } from "@/config/image-optimization"

describe("remote image optimization", () => {
  it("allows the HTTPS host used by seeded news images", () => {
    expect(
      resolveRemoteImagePatterns({ environment: {}, isDevelopment: false })
    ).toContainEqual({
      protocol: "https",
      hostname: "images.unsplash.com",
    })
  })

  it("allows only configured HTTPS origins in production", () => {
    expect(
      resolveRemoteImagePatterns({
        environment: {
          NEXT_PUBLIC_MEDIA_URL: "https://media.example.com/uploads",
          NEXT_PUBLIC_ASSET_HOST: "http://insecure.example.com/assets",
        },
        isDevelopment: false,
      })
    ).toEqual([
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "media.example.com" },
    ])
  })

  it("supports local HTTP image origins only in development", () => {
    expect(
      resolveRemoteImagePatterns({
        environment: {
          NEXT_PUBLIC_MEDIA_URL: "http://localhost:9000/uploads",
        },
        isDevelopment: true,
      })
    ).toContainEqual({
      protocol: "http",
      hostname: "localhost",
      port: "9000",
    })
  })

  it("deduplicates trusted and configured hosts", () => {
    expect(
      resolveRemoteImagePatterns({
        environment: {
          NEXT_PUBLIC_MEDIA_URL: "https://images.unsplash.com/another-path",
        },
        isDevelopment: false,
      }).filter((pattern) => pattern.hostname === "images.unsplash.com")
    ).toHaveLength(1)
  })
})
