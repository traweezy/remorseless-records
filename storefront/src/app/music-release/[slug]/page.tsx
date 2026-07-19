import type { Metadata } from "next"

import ProductDetailPage, {
  generateMetadata as generateProductMetadata,
} from "@/components/product-detail-page"
import { buildInternalHandleCandidates } from "@/lib/products/routes"

type MusicReleasePageProps = {
  params: Promise<{ slug: string }>
}

const toProductParams = async (
  params: MusicReleasePageProps["params"]
): Promise<{ handle: string }> => {
  const { slug } = await params
  return {
    handle: buildInternalHandleCandidates("music-release", slug)[0] ?? "",
  }
}

export const generateMetadata = async ({
  params,
}: MusicReleasePageProps): Promise<Metadata> =>
  generateProductMetadata({ params: toProductParams(params) })

const MusicReleasePage = async ({ params }: MusicReleasePageProps) =>
  ProductDetailPage({ params: toProductParams(params) })

export default MusicReleasePage
