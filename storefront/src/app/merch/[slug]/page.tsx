import type { Metadata } from "next"

import ProductDetailPage, {
  generateMetadata as generateProductMetadata,
} from "@/components/product-detail-page"
import { buildInternalHandleCandidates } from "@/lib/products/routes"

type MerchPageProps = {
  params: Promise<{ slug: string }>
}

const toProductParams = async (
  params: MerchPageProps["params"]
): Promise<{ handle: string }> => {
  const { slug } = await params
  return {
    handle: buildInternalHandleCandidates("merch", slug)[0] ?? "",
  }
}

export const generateMetadata = async ({
  params,
}: MerchPageProps): Promise<Metadata> =>
  generateProductMetadata({ params: toProductParams(params) })

const MerchPage = async ({ params }: MerchPageProps) =>
  ProductDetailPage({ params: toProductParams(params) })

export default MerchPage
