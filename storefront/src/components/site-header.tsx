import SiteHeaderShell from "@/components/site-header-shell"
import { getCart } from "@/lib/cart"
import { formatAmount } from "@/lib/money"

const SiteHeader = async () => {
  const cart = await getCart()
  const itemCount =
    cart?.items?.reduce(
      (total, item) => total + Number(item.quantity ?? 0),
      0
    ) ?? 0

  const currency = cart?.currency_code ?? "usd"
  const subtotalCents = Number(cart?.subtotal ?? cart?.total ?? 0)
  const subtotalDisplay =
    itemCount > 0 ? formatAmount(currency, subtotalCents) : null

  return (
    <SiteHeaderShell
      itemCount={itemCount}
      subtotalDisplay={subtotalDisplay}
    />
  )
}

export default SiteHeader
