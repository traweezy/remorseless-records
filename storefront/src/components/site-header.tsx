import SiteHeaderShell from "@/components/site-header-shell"
import { getCart } from "@/lib/cart"

const SiteHeader = async () => {
  const cart = await getCart()

  return <SiteHeaderShell cart={cart} />
}

export default SiteHeader
