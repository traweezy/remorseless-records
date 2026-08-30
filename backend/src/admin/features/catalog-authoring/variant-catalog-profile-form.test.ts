import {
  buildVariantCatalogProfilePayload,
  deriveVariantCatalogLabel,
  deriveVariantCustomerState,
  variantCatalogProfileFormSchema,
  variantCatalogProfileValues,
  variantCatalogProfileWasApplied,
  variantStockSummary,
} from "./variant-catalog-profile-form"
import type {
  CatalogReferenceValue,
  CatalogVariantProfile,
} from "./variant-catalog-profile-query"

const profile = (): CatalogVariantProfile => ({
  availabilityStatus: "in_stock",
  backorderAllowed: false,
  backorderNote: null,
  displayLabel: null,
  formatDetailId: "detail_1",
  formatDetailLabel: "Black",
  formatId: "format_1",
  formatLabel: "Vinyl",
  id: "profile_1",
  imageUrl: null,
  metadata: { rpm: 33 },
  preorderAllowed: false,
  preorderReleaseDate: null,
  productProfileId: "product_profile_1",
  variantId: "variant_1",
  version: 2,
})

const references: CatalogReferenceValue[] = [
  { id: "format_1", isActive: true, kind: "format", label: "Vinyl" },
  {
    id: "detail_1",
    isActive: true,
    kind: "format_detail",
    label: "Black",
  },
]

describe("Variant catalog profile form", () => {
  it("maps server state into a validated client form", () => {
    const values = variantCatalogProfileValues(profile(), () => "line_1")
    expect(variantCatalogProfileFormSchema.parse(values)).toMatchObject({
      format: "Vinyl",
      formatDetail: "Black",
      metadata: [{ id: "line_1", name: "rpm", value: "33" }],
    })
  })

  it("uses controlled references and keeps advanced values typed", () => {
    const values = variantCatalogProfileValues(profile(), () => "line_1")
    const payload = buildVariantCatalogProfilePayload({
      productId: "product_1",
      references,
      values,
    })
    expect(payload).toMatchObject({
      formatDetailId: "detail_1",
      formatId: "format_1",
      metadata: { rpm: 33 },
      productId: "product_1",
    })
    expect(payload).not.toHaveProperty("format")
    expect(
      variantCatalogProfileWasApplied({ profile: profile(), values })
    ).toBe(true)
  })

  it("rejects invalid URLs and duplicate advanced field names", () => {
    const values = variantCatalogProfileValues(profile(), () => "line_1")
    expect(
      variantCatalogProfileFormSchema.safeParse({
        ...values,
        imageUrl: "javascript:alert(1)",
      }).success
    ).toBe(false)
    expect(
      variantCatalogProfileFormSchema.safeParse({
        ...values,
        metadata: [
          { id: "1", name: "RPM", value: "33" },
          { id: "2", name: "rpm", value: "45" },
        ],
      }).success
    ).toBe(false)
  })

  it("derives plain-language label, stock, and customer state", () => {
    expect(deriveVariantCatalogLabel("Vinyl", "Black")).toBe("Vinyl - Black")
    const variant = {
      id: "variant_1",
      inventory_quantity: 3,
      manage_inventory: true,
    }
    expect(variantStockSummary(variant)).toContain("3 available")
    expect(
      deriveVariantCustomerState({
        backorderAllowed: false,
        nativeBackorderAllowed: false,
        now: new Date("2030-01-01T00:00:00.000Z"),
        preorderAllowed: false,
        releaseDate: null,
        variant,
      })
    ).toMatchObject({ label: "Low stock" })
  })
})
