"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Menu, ShoppingCart, X } from "lucide-react"

import CartDrawer from "@/components/cart-drawer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useCartQuery, prefetchCartQuery } from "@/lib/query/cart"
import { formatAmount } from "@/lib/money"
import { cn } from "@/lib/ui/cn"
import { useQueryClient } from "@tanstack/react-query"

const NAV_LINKS = [
  { href: "/products", label: "Catalog" },
  { href: "/order/confirmed", label: "Orders" },
]

const SiteHeaderShell = () => {
  const pathname = usePathname()
  const router = useRouter()
  const [isCartOpen, setCartOpen] = useState(false)
  const [scrollProgress, setScrollProgress] = useState(0)
  const { data: cart } = useCartQuery()
  const queryClient = useQueryClient()

  const prefetchCart = useCallback(() => {
    void prefetchCartQuery(queryClient)
  }, [queryClient])

  const prefetchRoute = useCallback(
    (href: string) => {
      void router.prefetch(href)
    },
    [router]
  )

  const activeHref = useMemo(() => {
    if (!pathname) {
      return null
    }

    const match = NAV_LINKS.find((link) =>
      pathname.startsWith(link.href)
    )
    return match?.href ?? null
  }, [pathname])

  const itemCount =
    cart?.items?.reduce((total, item) => total + Number(item.quantity ?? 0), 0) ?? 0

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
      ? `${itemCount} • ${subtotalDisplay}`
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

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-lg relative">
      <div className="container flex h-16 items-center justify-between">
        <Link
          href="/"
          data-prefetch="true"
          className="flex items-center gap-3 text-sm uppercase tracking-[0.3rem] text-muted-foreground transition hover:text-destructive"
        >
          <span className="font-bebas text-3xl text-destructive glow-red-sm">
            RR
          </span>
          <span className="hidden font-teko text-xl text-muted-foreground sm:inline">
            Remorseless Records
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              data-prefetch="true"
              onPointerEnter={() => prefetchRoute(link.href)}
              onFocus={() => prefetchRoute(link.href)}
              className={cn(
                "text-sm font-semibold uppercase tracking-[0.3rem] text-muted-foreground transition hover:text-destructive",
                activeHref === link.href && "text-destructive"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="relative"
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
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader className="mb-6 space-y-2 text-left">
                <SheetTitle className="font-bebas text-2xl text-destructive">
                  Remorseless Records
                </SheetTitle>
                <SheetDescription className="text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                  Navigate
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-4">
                {NAV_LINKS.map((link) => (
                  <SheetClose asChild key={link.href}>
                    <Link
                      href={link.href}
                      data-prefetch="true"
                      onPointerEnter={() => prefetchRoute(link.href)}
                      onFocus={() => prefetchRoute(link.href)}
                      className={cn(
                        "rounded-full border border-border/60 px-4 py-3 text-sm font-semibold uppercase tracking-[0.3rem] text-muted-foreground transition hover:border-destructive hover:text-destructive",
                        activeHref === link.href && "border-destructive text-destructive"
                      )}
                    >
                      {link.label}
                    </Link>
                  </SheetClose>
                ))}
                <SheetClose asChild>
                  <Link
                    href="/cart"
                    data-prefetch="true"
                    onPointerEnter={() => {
                      prefetchRoute("/cart")
                      prefetchCart()
                    }}
                    onFocus={() => {
                      prefetchRoute("/cart")
                      prefetchCart()
                    }}
                    className="inline-flex items-center justify-between rounded-full border border-border/60 px-4 py-3 text-sm font-semibold uppercase tracking-[0.3rem] text-muted-foreground transition hover:border-destructive hover:text-destructive"
                  >
                    <span>Cart</span>
                    <span className="rounded-full bg-destructive px-3 py-1 text-xs text-white">
                      {cartLabel}
                    </span>
                  </Link>
                </SheetClose>
              </div>
              <SheetClose className="absolute right-4 top-4 rounded-full border border-border/60 p-2 text-muted-foreground transition hover:border-destructive hover:text-destructive">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </SheetClose>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-border/10 shadow-[0_0_18px_hsl(0_70%_50%/0.35)]">
        <div
          className="h-full rounded-full bg-destructive shadow-[0_0_25px_hsl(0_70%_50%/0.55)] transition-[width] duration-400 ease-[cubic-bezier(0.4,0.1,0,1)]"
          style={{ width: `${scrollProgress * 100}%` }}
        />
      </div>
      <CartDrawer open={isCartOpen} onOpenChange={setCartOpen} />
    </header>
  )
}

export default SiteHeaderShell
