import { describe, expect, it } from "vitest"

import {
  buildBundleAvailabilityNotices,
  buildBundleItemPresentation,
  hasUnavailableBundleComponents,
} from "@/lib/products/bundle-availability"
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

describe("bundle item presentation", () => {
  const multiFormatBundle: BundleComposition = {
    ...bundle,
    componentCount: 1,
    components: [
      {
        id: "component_multi",
        title: "Included Album",
        quantity: 1,
        required: true,
        product: { id: null, handle: null, title: null },
        availabilityByBundleVariant: [
          {
            bundleVariantIds: ["variant_cd"],
            bundleVariantTitles: ["3CD Bundle"],
            selectionMode: "exact",
            available: true,
            options: [],
          },
          {
            bundleVariantIds: ["variant_lp"],
            bundleVariantTitles: ["3LP Bundle"],
            selectionMode: "exact",
            available: false,
            options: [],
          },
        ],
      },
    ],
  }

  it("shows only the selected bundle format and its availability", () => {
    const [component] = multiFormatBundle.components

    expect(buildBundleItemPresentation(component!, "variant_cd")).toEqual({
      formatLabel: "3CD",
      status: "in_stock",
    })
    expect(buildBundleItemPresentation(component!, "variant_lp")).toEqual({
      formatLabel: "3LP",
      status: "sold_out",
    })
  })

  it("keeps the sold-out summary scoped to the selected format", () => {
    expect(
      hasUnavailableBundleComponents(multiFormatBundle, "variant_cd")
    ).toBe(false)
    expect(
      hasUnavailableBundleComponents(multiFormatBundle, "variant_lp")
    ).toBe(true)
  })

  it("omits redundant subtext for a generic single-format bundle", () => {
    const singleFormatComponent: BundleComposition["components"][number] = {
      ...multiFormatBundle.components[0]!,
      availabilityByBundleVariant: [
        {
          bundleVariantIds: ["variant_bundle"],
          bundleVariantTitles: ["Bundle"],
          selectionMode: "exact",
          available: true,
          options: [],
        },
      ],
    }

    expect(
      buildBundleItemPresentation(singleFormatComponent, "variant_bundle")
    ).toEqual({
      formatLabel: null,
      status: "in_stock",
    })
  })
})
