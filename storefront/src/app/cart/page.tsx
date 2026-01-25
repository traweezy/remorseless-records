import { redirect } from "next/navigation"

const CartPage = () => {
  redirect("/?cart=1")
}

export default CartPage
