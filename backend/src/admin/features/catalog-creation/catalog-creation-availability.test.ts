import { resolveCatalogCreationAvailability } from "./catalog-creation-availability"
import {
  applyCatalogCreationKind,
  createCatalogCreationDefaults,
} from "./catalog-product-create-form"
import type { CatalogCreationProductChoiceWithStock } from "./catalog-product-create-query"

const now = Date.UTC(2026, 7, 1)

describe("catalog creation availability", () => {
  it("explains inventory, backorder, and preorder outcomes from native state", () => {
    const values = createCatalogCreationDefaults()
    const offering = values.offerings[0]!
    const input: Parameters<typeof resolveCatalogCreationAvailability>[0] = {
      bundleComponents: values.bundleComponents,
      choices: [],
      kind: values.kind,
      now,
      offering,
      releaseDate: values.releaseDate,
      releaseDatePrecision: values.releaseDatePrecision,
    }

    expect(resolveCatalogCreationAvailability(input)).toMatchObject({
      label: "Sold out",
      status: "sold_out",
    })
    expect(
      resolveCatalogCreationAvailability({
        ...input,
        offering: { ...offering, availabilityPolicy: "backorder" },
      })
    ).toMatchObject({ label: "Backorder", status: "backorder" })
    expect(
      resolveCatalogCreationAvailability({
        ...input,
        offering: {
          ...offering,
          availabilityPolicy: "preorder",
        },
        releaseDate: "2099-08-01",
        releaseDatePrecision: "day",
      })
    ).toMatchObject({ label: "Preorder", status: "preorder" })
    expect(
      resolveCatalogCreationAvailability({
        ...input,
        offering: { ...offering, stockQuantity: "3" },
      })
    ).toMatchObject({ label: "Low stock", status: "low_stock" })
  })

  it("derives fixed-bundle capacity from the limiting component", () => {
    const values = applyCatalogCreationKind(
      createCatalogCreationDefaults(),
      "fixed_bundle"
    )
    const offering = values.offerings[0]!
    values.bundleComponents = [
      {
        id: "component",
        offeringIds: [offering.id],
        productId: "product",
        quantity: "2",
        variantId: "variant",
      },
    ]
    const choices: CatalogCreationProductChoiceWithStock[] = [
      {
        id: "product",
        title: "Component release",
        variants: [
          {
            id: "variant",
            inventoryQuantity: 5,
            managesInventory: true,
            sku: null,
            title: "CD",
          },
        ],
      },
    ]
    const input: Parameters<typeof resolveCatalogCreationAvailability>[0] = {
      bundleComponents: values.bundleComponents,
      choices,
      kind: values.kind,
      now,
      offering,
      releaseDate: values.releaseDate,
      releaseDatePrecision: values.releaseDatePrecision,
    }

    expect(resolveCatalogCreationAvailability(input)).toMatchObject({
      label: "Low stock",
      reason: expect.stringContaining("2 complete bundles"),
      status: "low_stock",
    })
    choices[0]!.variants[0]!.inventoryQuantity = 1
    expect(resolveCatalogCreationAvailability(input)).toMatchObject({
      label: "Sold out",
      status: "sold_out",
    })
    choices[0]!.variants[0]!.inventoryQuantity = null
    expect(resolveCatalogCreationAvailability(input)).toMatchObject({
      label: "Stock unavailable",
      status: "unknown",
    })

    choices[0]!.variants[0]!.inventoryQuantity = 5
    choices[0]!.variants[0]!.managesInventory = false
    expect(resolveCatalogCreationAvailability(input)).toMatchObject({
      label: "In stock",
      reason: expect.stringContaining("inventory tracking disabled"),
      status: "in_stock",
    })
  })

  it("explains incomplete bundle mappings and invalid preorder dates", () => {
    const fixedBundle = applyCatalogCreationKind(
      createCatalogCreationDefaults(),
      "fixed_bundle"
    )
    expect(
      resolveCatalogCreationAvailability({
        bundleComponents: [],
        choices: [],
        kind: fixedBundle.kind,
        now,
        offering: fixedBundle.offerings[0]!,
        releaseDate: fixedBundle.releaseDate,
        releaseDatePrecision: fixedBundle.releaseDatePrecision,
      })
    ).toMatchObject({ label: "Stock unavailable", status: "unknown" })

    const music = createCatalogCreationDefaults()
    expect(
      resolveCatalogCreationAvailability({
        bundleComponents: [],
        choices: [],
        kind: music.kind,
        now,
        offering: {
          ...music.offerings[0]!,
          availabilityPolicy: "preorder",
        },
        releaseDate: "2026-07-31",
        releaseDatePrecision: "day",
      })
    ).toMatchObject({ label: "Stock unavailable", status: "unknown" })
  })
})
