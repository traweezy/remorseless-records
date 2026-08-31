import { managedMediaUsagePlan } from "@/lib/catalog/managed-media"
import { MANAGED_IMAGE_NORMALIZER_VERSION } from "@/lib/uploads/image-normalization"

import { readManagedMediaState } from "./migrate-big-cartel-media"

const sourceUrl = "https://assets.example.test/source.jpg"
const validState = () => ({
  createdAt: "2026-08-31T04:00:00.000Z",
  entries: {
    [sourceUrl]: {
      byteSize: 1_024,
      completedAt: "2026-08-31T04:01:00.000Z",
      fileKey: "managed/source.webp",
      height: 1_200,
      managedUrl: "https://media.example.test/source.webp",
      mimeType: "image/webp",
      normalizerVersion: MANAGED_IMAGE_NORMALIZER_VERSION,
      originalUrls: [sourceUrl],
      sha256: "a".repeat(64),
      sourceByteSize: 2_048,
      sourceMimeType: "image/jpeg",
      sourceSha256: "b".repeat(64),
      sourceUrl,
      width: managedMediaUsagePlan.masterWidth,
    },
  },
  masterWidth: managedMediaUsagePlan.masterWidth,
  schemaVersion: 2,
  updatedAt: "2026-08-31T04:01:00.000Z",
})

describe("managed-media migration state", () => {
  it("rebuilds the bounded persisted state projection", () => {
    expect(readManagedMediaState(validState())).toEqual(validState())
  })

  it("rejects arrays and mismatched source identities", () => {
    expect(() => readManagedMediaState([])).toThrow("unsupported schema")
    const state = validState()
    state.entries[sourceUrl].sourceUrl = "https://assets.example.test/other.jpg"
    expect(() => readManagedMediaState(state)).toThrow(
      `Managed-media state for ${sourceUrl} is invalid.`
    )
  })
})
