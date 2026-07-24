import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import BundleComposition from "@/components/bundle-composition"
import ProductVariantSelector from "@/components/product-variant-selector"
import { ProductVariantSelectionProvider } from "@/components/providers/product-variant-selection-provider"
import type { BundleComposition as BundleCompositionData } from "@/types/bundle"
import type { VariantOption } from "@/types/product"

vi.mock("@/providers/cart-provider", () => ({
  useCart: () => ({
    addItem: vi.fn(),
  }),
}))

const variants: VariantOption[] = [
  {
    id: "variant_cd",
    title: "3CD Bundle",
    currency: "usd",
    amount: 3_300,
    hasPrice: true,
    inStock: true,
    stockStatus: "in_stock",
    inventoryQuantity: 10,
  },
  {
    id: "variant_lp",
    title: "3LP Bundle",
    currency: "usd",
    amount: 5_600,
    hasPrice: true,
    inStock: true,
    stockStatus: "in_stock",
    inventoryQuantity: 10,
  },
]

const bundle: BundleCompositionData = {
  productId: "prod_bundle",
  handle: "multi-format-bundle",
  title: "Multi-format Bundle",
  type: "fixed",
  componentCount: 1,
  unavailableMappingCount: 0,
  hasUnavailableComponents: false,
  components: [
    {
      id: "component_album",
      title: "Included Album",
      quantity: 1,
      required: true,
      product: {
        id: null,
        handle: null,
        title: null,
      },
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
          available: true,
          options: [],
        },
      ],
    },
  ],
}

describe("BundleComposition", () => {
  afterEach(cleanup)

  it("updates item format context when the selected bundle variant changes", () => {
    render(
      <ProductVariantSelectionProvider initialVariantId="variant_cd">
        <ProductVariantSelector
          variants={variants}
          productTitle="Multi-format Bundle"
        />
        <BundleComposition bundle={bundle} />
      </ProductVariantSelectionProvider>
    )

    expect(screen.getByText("3CD", { exact: true })).toBeInTheDocument()
    expect(screen.queryByText("3LP", { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText("In stock", { exact: true })).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole("button", {
        name: /3LP Bundle/i,
      })
    )

    expect(screen.getByText("3LP", { exact: true })).toBeInTheDocument()
    expect(screen.queryByText("3CD", { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText("In stock", { exact: true })).toBeInTheDocument()
  })
})
