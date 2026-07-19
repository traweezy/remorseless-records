import type { Metadata } from "next"

import ProductDetailPage, {
  generateMetadata as generateProductMetadata,
} from "@/components/product-detail-page"
import { getProductByHandle } from "@/lib/data/products"
import { buildInternalHandleCandidates } from "@/lib/products/routes"

type BundlePageProps = {
  params: Promise<{ slug: string }>
}

const toProductParams = async (
  params: BundlePageProps["params"]
): Promise<{ handle: string }> => {
  const { slug } = await params
  const candidates = buildInternalHandleCandidates("bundle", slug)
  for (const handle of candidates) {
    const product = await getProductByHandle(handle)
    if (product) {
      return { handle }
    }
  }
  return { handle: candidates[0] ?? "" }
}

export const generateMetadata = async ({
  params,
}: BundlePageProps): Promise<Metadata> =>
  generateProductMetadata({ params: toProductParams(params) })

const BundlePage = async ({ params }: BundlePageProps) =>
  ProductDetailPage({ params: toProductParams(params) })

export default BundlePage
