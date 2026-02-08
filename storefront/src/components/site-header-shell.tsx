"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Menu, ShoppingCart, X } from "lucide-react"

import CartDrawer from "@/components/cart-drawer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import Drawer from "@/components/ui/drawer"
import SmartLink from "@/components/ui/smart-link"
import { formatAmount } from "@/lib/money"
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
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isCartOpen, setCartOpen] = useState(false)
  const [isMenuOpen, setMenuOpen] = useState(false)
  const [scrollProgress, setScrollProgress] = useState(0)
  const { cart, itemCount, refreshCart } = useCart()

  const prefetchCart = useCallback(() => {
    void refreshCart({ silent: true })
  }, [refreshCart])

  const activeHref = useMemo(() => {
    if (!pathname) {
      return null
    }

    const match = NAV_LINKS.find((link) => pathname === link.href)
    return match?.href ?? null
  }, [pathname])

  const subtotalDisplay = useMemo(() => {
    if (!cart?.subtotal && !cart?.total) {
      return null
    }

    return formatAmount(
      cart.currency_code ?? "usd",
      Number(cart.subtotal ?? cart.total ?? 0)
    )
  }, [cart?.currency_code, cart?.subtotal, cart?.total])

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
      const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight
      const progress =
        scrollableHeight <= 0 ? 0 : Math.min(1, Math.max(0, scrollTop / scrollableHeight))
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
    const stored = window.localStorage.getItem("rr.cart.open")
    if (!shouldOpenCart && stored !== "1") {
      return
    }

    window.localStorage.removeItem("rr.cart.open")
    setCartOpen(true)

    if (shouldOpenCart) {
      const url = new URL(window.location.href)
      url.searchParams.delete("cart")
      router.replace(`${url.pathname}${url.search}${url.hash}`)
    }
  }, [router, searchParams])

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
            variant="ghost"
            size="icon"
            className="relative text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Open cart"
            onClick={() => setCartOpen(true)}
            onPointerEnter={prefetchCart}
            onFocus={prefetchCart}
          >
            <ShoppingCart className="h-5 w-5" />
            {hasItems ? (
              <Badge className="absolute -right-2 -top-2 h-5 w-5 justify-center rounded-full bg-destructive text-xs text-white">
                {itemCount}
              </Badge>
            ) : null}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open navigation"
            onClick={() => setMenuOpen(true)}
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
                      activeHref === link.href && "border-destructive text-destructive"
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
                  <span className="max-w-[9rem] truncate rounded-full bg-destructive px-3 py-1 text-xs text-white">
                    {cartLabel}
                  </span>
                </button>
              </div>
              <button
                type="button"
                className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/60 p-2 text-muted-foreground transition hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:h-9 sm:w-9"
                aria-label="Close navigation"
                onClick={() => setMenuOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
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
      <CartDrawer open={isCartOpen} onOpenChange={setCartOpen} />
    </header>
  )
}

export default SiteHeaderShell
