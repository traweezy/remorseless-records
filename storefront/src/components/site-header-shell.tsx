"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { usePathname, useSearchParams } from "next/navigation"
import { Menu, ShoppingCart } from "lucide-react"

import CartDrawer from "@/components/cart-drawer"
import { useCookieConsent } from "@/components/legal/cookie-consent-provider"
import { Button } from "@/components/ui/button"
import Drawer, { DrawerCloseButton } from "@/components/ui/drawer"
import SmartLink from "@/components/ui/smart-link"
import { cartAmount } from "@/lib/cart/snapshot"
import { formatAmount } from "@/lib/money"
import { useUIStore } from "@/lib/store/ui"
import { cn } from "@/lib/ui/cn"
import { useCart } from "@/providers/cart-provider"

const NAV_LINKS = [
  { href: "/catalog", label: "Catalog" },
  { href: "/discography", label: "Discography" },
  { href: "/news", label: "News" },
  { href: "/contact", label: "Contact" },
]

const SiteHeaderShell = () => {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isMenuOpen, setMenuOpen] = useState(false)
  const [scrollProgress, setScrollProgress] = useState(0)
  const { isCartOpen, setCartOpen } = useUIStore((state) => ({
    isCartOpen: state.isCartOpen,
    setCartOpen: state.setCartOpen,
  }))
  const { cart, itemCount, refreshCart } = useCart()
  const { hasStoredPreferences, isHydrated: isConsentHydrated } =
    useCookieConsent()

  const prefetchCart = useCallback(() => {
    void refreshCart({ silent: true })
  }, [refreshCart])
  const openCart = useCallback(() => {
    setCartOpen(true)
  }, [setCartOpen])
  const handleCartOpenChange = useCallback(
    (open: boolean) => {
      setCartOpen(open)
      if (open || typeof window === "undefined") {
        return
      }
      const url = new URL(window.location.href)
      if (url.searchParams.get("cart") !== "1") {
        return
      }
      url.searchParams.delete("cart")
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`
      )
    },
    [setCartOpen]
  )
  const openMenu = useCallback(() => {
    setMenuOpen(true)
  }, [])

  const activeHref = useMemo(() => {
    if (!pathname) {
      return null
    }

    const match = NAV_LINKS.find((link) => pathname === link.href)
    return match?.href ?? null
  }, [pathname])

  const cartCurrencyCode = cart?.currency_code ?? "usd"
  const cartSubtotal = cart?.subtotal
  const cartTotal = cart?.total
  const subtotalDisplay = useMemo(() => {
    const amount = cartAmount(cartSubtotal) ?? cartAmount(cartTotal)
    if (amount === null) {
      return null
    }

    return formatAmount(cartCurrencyCode, amount)
  }, [cartCurrencyCode, cartSubtotal, cartTotal])

  const hasItems = itemCount > 0
  const cartLabel = hasItems
    ? subtotalDisplay
      ? `${itemCount} - ${subtotalDisplay}`
      : `${itemCount} items`
    : "Empty"

  useEffect(() => {
    const latestProgress = { value: 0 }
    let animationFrame: number | null = null

    const updateProgress = () => {
      setScrollProgress(latestProgress.value)
      animationFrame = null
    }

    const handleScroll = () => {
      const scrollTop = window.scrollY
      const scrollableHeight =
        document.documentElement.scrollHeight - window.innerHeight
      const progress =
        scrollableHeight <= 0
          ? 0
          : Math.min(1, Math.max(0, scrollTop / scrollableHeight))
      latestProgress.value = progress
      animationFrame ??= window.requestAnimationFrame(updateProgress)
    }

    handleScroll()
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", handleScroll)
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame)
      }
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    root.classList.add("no-scrollbar")
    body.classList.add("no-scrollbar")
    return () => {
      root.classList.remove("no-scrollbar")
      body.classList.remove("no-scrollbar")
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const shouldOpenCart = searchParams?.get("cart") === "1"
    if (!shouldOpenCart || !isConsentHydrated || !hasStoredPreferences) {
      return
    }

    setCartOpen(true)
  }, [hasStoredPreferences, isConsentHydrated, searchParams, setCartOpen])

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-lg relative">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <SmartLink
          href="/"
          nativePrefetch
          className="flex items-center gap-3 text-sm uppercase tracking-[0.3rem] text-muted-foreground transition hover:text-destructive"
        >
          <span className="relative inline-flex h-10 w-10 items-center justify-center">
            <Image
              src="/remorseless-header-logo.png"
              alt="Remorseless Records logo"
              width={40}
              height={40}
              className="h-10 w-10 object-contain"
              priority
            />
          </span>
          <span className="hidden font-teko text-xl text-muted-foreground sm:inline">
            Remorseless Records
          </span>
        </SmartLink>

        <div className="flex items-center gap-2 sm:gap-4">
          {!pathname?.startsWith("/checkout") ? (
            <nav className="hidden items-center md:flex">
              {NAV_LINKS.map((link) => (
                <SmartLink
                  key={link.href}
                  href={link.href}
                  nativePrefetch
                  className={cn(
                    "rounded-full px-3 py-2 text-sm font-semibold uppercase tracking-[0.3rem] text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    activeHref === link.href && "text-destructive"
                  )}
                >
                  {link.label}
                </SmartLink>
              ))}
            </nav>
          ) : null}
          <Button
            variant="outlined"
            size="auto"
            className="h-11 min-w-11 gap-2 rounded-full border-border/70 bg-background/70 px-3 text-muted-foreground shadow-sm hover:border-destructive/70 hover:bg-destructive/5 hover:text-foreground focus-visible:ring-destructive focus-visible:ring-offset-background"
            aria-label={
              hasItems
                ? `Open cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`
                : "Open cart, empty"
            }
            onClick={openCart}
            onPointerEnter={prefetchCart}
            onFocus={prefetchCart}
          >
            <ShoppingCart className="h-5 w-5 shrink-0" aria-hidden />
            <span className="hidden text-xs font-semibold uppercase tracking-[0.18rem] sm:inline">
              Cart
            </span>
            {hasItems ? (
              <span
                className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-bold leading-none text-destructive-foreground"
                aria-hidden
              >
                {itemCount > 99 ? "99+" : itemCount}
              </span>
            ) : null}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open navigation"
            onClick={openMenu}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Drawer
            open={isMenuOpen}
            onOpenChange={setMenuOpen}
            ariaLabel="Navigation"
            maxWidthClassName="max-w-[360px]"
          >
            <div className="relative flex h-full flex-col gap-6 px-5 py-6">
              <div className="space-y-2 text-left">
                <p className="font-bebas text-2xl text-destructive">
                  Remorseless Records
                </p>
                <p className="text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                  Navigate
                </p>
              </div>
              <div className="flex flex-col gap-4">
                {NAV_LINKS.map((link) => (
                  <SmartLink
                    key={link.href}
                    href={link.href}
                    nativePrefetch
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      "rounded-full border border-border/60 px-4 py-3 text-sm font-semibold uppercase tracking-[0.22rem] text-muted-foreground transition hover:border-destructive hover:text-destructive sm:tracking-[0.3rem]",
                      activeHref === link.href &&
                        "border-destructive text-destructive"
                    )}
                  >
                    {link.label}
                  </SmartLink>
                ))}
                <button
                  type="button"
                  onPointerEnter={prefetchCart}
                  onFocus={prefetchCart}
                  onClick={() => {
                    setMenuOpen(false)
                    setCartOpen(true)
                  }}
                  className="inline-flex items-center justify-between rounded-full border border-border/60 px-4 py-3 text-sm font-semibold uppercase tracking-[0.22rem] text-muted-foreground transition hover:border-destructive hover:text-destructive sm:tracking-[0.3rem]"
                >
                  <span>Cart</span>
                  <span className="max-w-[9rem] truncate rounded-full bg-destructive px-3 py-1 text-xs text-destructive-foreground">
                    {cartLabel}
                  </span>
                </button>
              </div>
              <DrawerCloseButton
                className="absolute right-4 top-4 border-border/60 hover:border-destructive hover:text-destructive focus-visible:ring-destructive"
                label="Close navigation"
              />
            </div>
          </Drawer>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-border/10 shadow-[0_0_18px_hsl(0_70%_50%/0.35)]">
        <div
          className="h-full rounded-full bg-destructive shadow-[0_0_25px_hsl(0_70%_50%/0.55)] transition-[width] duration-[400ms]"
          style={{
            width: `${scrollProgress * 100}%`,
            transitionTimingFunction: "cubic-bezier(0.4,0.1,0,1)",
          }}
        />
      </div>
      <CartDrawer open={isCartOpen} onOpenChange={handleCartOpenChange} />
    </header>
  )
}

export default SiteHeaderShell
