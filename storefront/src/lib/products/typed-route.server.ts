import "server-only"

import { getProductByHandle } from "@/lib/data/products"
import { productPresentationType } from "./presentation"
import {
  buildInternalHandleCandidates,
  resolvePublicProductRouteType,
  type PublicProductRouteType,
} from "./routes"

export const resolveTypedProductHandle = async (
  routeType: PublicProductRouteType,
  slug: string
): Promise<string> => {
  for (const handle of buildInternalHandleCandidates(routeType, slug)) {
    const product = await getProductByHandle(handle)
    if (
      product &&
      resolvePublicProductRouteType({
        handle: product.handle,
        productType: productPresentationType(product),
      }) === routeType
    )
      return handle
  }
  return ""
}
