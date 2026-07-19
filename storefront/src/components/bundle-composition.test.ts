import { describe, expect, it } from "vitest"

import { buildBundleAvailabilityNotices } from "@/components/bundle-composition"
import type { BundleComposition } from "@/types/bundle"

const bundle: BundleComposition = {
  productId: "prod_bundle",
  handle: "fixed-bundle-test",
  title: "Test Bundle",
  type: "fixed",
  componentCount: 2,
  unavailableMappingCount: 1,
  hasUnavailableComponents: true,
  components: [
    {
      id: "component_cd",
      title: "Included CD",
      quantity: 1,
      required: true,
      product: { id: "prod_cd", handle: "music-release-cd", title: "CD" },
      availabilityByBundleVariant: [
        {
          bundleVariantIds: ["variant_cd"],
          bundleVariantTitles: ["CD Bundle"],
          selectionMode: "exact",
          available: false,
          options: [],
        },
      ],
    },
    {
      id: "component_lp",
      title: "Included LP",
      quantity: 1,
      required: true,
      product: { id: "prod_lp", handle: "music-release-lp", title: "LP" },
      availabilityByBundleVariant: [
        {
          bundleVariantIds: ["variant_lp"],
          bundleVariantTitles: ["LP Bundle"],
          selectionMode: "exact",
          available: true,
          options: [],
        },
      ],
    },
  ],
}

describe("bundle availability notices", () => {
  it("explains the sold-out component only for its affected bundle variant", () => {
    expect(buildBundleAvailabilityNotices(bundle)).toEqual({
      variant_cd: "1 included item is sold out: Included CD.",
    })
  })
})
