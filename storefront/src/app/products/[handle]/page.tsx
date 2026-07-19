import type { Metadata } from "next"
import { notFound, permanentRedirect } from "next/navigation"

import ProductDetailPage, {
  generateMetadata as generateProductMetadata,
  type ProductDetailPageProps,
} from "@/components/product-detail-page"
import { getProductByHandle } from "@/lib/data/products"
import { buildPublicProductPath } from "@/lib/products/routes"

export const generateMetadata = async (
  props: ProductDetailPageProps
): Promise<Metadata> => generateProductMetadata(props)

const LegacyProductPage = async ({ params }: ProductDetailPageProps) => {
  const { handle } = await params
  const product = await getProductByHandle(handle)
  if (!product) {
    notFound()
  }

  const canonicalPath = buildPublicProductPath({ handle: product.handle })
  if (!canonicalPath.startsWith("/products/")) {
    permanentRedirect(canonicalPath)
  }

  return ProductDetailPage({ params: Promise.resolve({ handle }) })
}

export default LegacyProductPage
