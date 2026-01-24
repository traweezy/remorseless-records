const CART_ID_KEY = "cart_id"

export const getCartId = (): string | null => {
  if (typeof window === "undefined") {
    return null
  }

  return window.localStorage.getItem(CART_ID_KEY)
}

export const setCartId = (cartId: string): void => {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(CART_ID_KEY, cartId)
}

export const clearCartId = (): void => {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.removeItem(CART_ID_KEY)
}
