export type ProductOptionStatus = "idle" | "loading" | "ready" | "error"

export const catalogProductOptionLimit = 200

export const getCatalogProductOptionPath = (offset = 0): string =>
  `/admin/products?limit=${catalogProductOptionLimit}&offset=${offset}&fields=*variants,*variants.prices`

type IdentifiedProduct = {
  id: string
}

export const getPrimaryProductLoadPath = (
  dedicatedProductId: string | undefined
): string => {
  if (!dedicatedProductId) {
    return getCatalogProductOptionPath()
  }
  const encodedProductId = encodeURIComponent(dedicatedProductId)
  return `/admin/products/${encodedProductId}?fields=*variants,*variants.prices`
}

export const getRemainingProductOptionOffsets = (count: number): number[] => {
  const pageCount = Math.ceil(Math.max(0, count) / catalogProductOptionLimit)
  return Array.from(
    { length: Math.max(0, pageCount - 1) },
    (_, index) => (index + 1) * catalogProductOptionLimit
  )
}

export const mergeExactProduct = <Product extends IdentifiedProduct>(
  exactProduct: Product,
  currentProducts: Product[]
): Product[] => [
  exactProduct,
  ...currentProducts.filter((product) => product.id !== exactProduct.id),
]

export const mergeProductOptions = <Product extends IdentifiedProduct>(
  currentProducts: Product[],
  productOptions: Product[],
  selectedProductId: string
): Product[] => {
  const selectedProduct =
    currentProducts.find((product) => product.id === selectedProductId) ?? null

  return selectedProduct
    ? mergeExactProduct(selectedProduct, productOptions)
    : productOptions
}

export const shouldLoadBundleProductOptions = ({
  bundleEnabled,
  dedicatedProductId,
  status,
}: {
  bundleEnabled: boolean
  dedicatedProductId: string | undefined
  status: ProductOptionStatus
}): boolean =>
  Boolean(dedicatedProductId) && bundleEnabled && status === "idle"
