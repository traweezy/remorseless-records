import type { Metadata } from "next"

import ProductDetailPage, {
  generateMetadata as generateProductMetadata,
} from "@/components/product-detail-page"
import { resolveTypedProductHandle } from "@/lib/products/typed-route.server"

type BundlePageProps = {
  params: Promise<{ slug: string }>
}

const toProductParams = async (
  params: BundlePageProps["params"]
): Promise<{ handle: string }> => {
  const { slug } = await params
  return { handle: await resolveTypedProductHandle("bundle", slug) }
}

export const generateMetadata = async ({
  params,
}: BundlePageProps): Promise<Metadata> =>
  generateProductMetadata({ params: toProductParams(params) })

const BundlePage = async ({ params }: BundlePageProps) =>
  ProductDetailPage({ params: toProductParams(params) })

export default BundlePage
