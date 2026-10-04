import type { Metadata } from "next"

import ProductDetailPage, {
  generateMetadata as generateProductMetadata,
} from "@/components/product-detail-page"
import { resolveTypedProductHandle } from "@/lib/products/typed-route.server"

type MusicReleasePageProps = {
  params: Promise<{ slug: string }>
}

const toProductParams = async (
  params: MusicReleasePageProps["params"]
): Promise<{ handle: string }> => {
  const { slug } = await params
  return { handle: await resolveTypedProductHandle("music-release", slug) }
}

export const generateMetadata = async ({
  params,
}: MusicReleasePageProps): Promise<Metadata> =>
  generateProductMetadata({ params: toProductParams(params) })

const MusicReleasePage = async ({ params }: MusicReleasePageProps) =>
  ProductDetailPage({ params: toProductParams(params) })

export default MusicReleasePage
