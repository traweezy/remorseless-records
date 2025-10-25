import { HydrationBoundary } from "@tanstack/react-query"

import SiteHeaderShell from "@/components/site-header-shell"
import { getCart } from "@/lib/cart"
import { createDehydratedCartState } from "@/lib/query/cart"

const SiteHeader = async () => {
  const cart = await getCart()
  const dehydratedState = createDehydratedCartState(cart ?? null)

  return (
    <HydrationBoundary state={dehydratedState}>
      <SiteHeaderShell />
    </HydrationBoundary>
  )
}

export default SiteHeader
