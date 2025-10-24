"use client"

import { useMemo } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, ShoppingCart, X } from "lucide-react"

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
import { cn } from "@/lib/ui/cn"

type SiteHeaderShellProps = {
  itemCount: number
  subtotalDisplay: string | null
}

const NAV_LINKS = [
  { href: "/products", label: "Catalog" },
  { href: "/order/confirmed", label: "Orders" },
]

const SiteHeaderShell = ({
  itemCount,
  subtotalDisplay,
}: SiteHeaderShellProps) => {
  const pathname = usePathname()

  const activeHref = useMemo(() => {
    if (!pathname) {
      return null
    }

    const match = NAV_LINKS.find((link) =>
      pathname.startsWith(link.href)
    )
    return match?.href ?? null
  }, [pathname])

  const hasItems = itemCount > 0
  const cartLabel = hasItems
    ? subtotalDisplay
      ? `${itemCount} · ${subtotalDisplay}`
      : `${itemCount} items`
    : "Empty"

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-lg">
      <div className="container flex h-16 items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-3 text-xs uppercase tracking-[0.35rem] text-muted-foreground transition hover:text-destructive"
        >
          <span className="font-bebas text-3xl text-destructive glow-red-sm">
            RR
          </span>
          <span className="hidden font-teko text-lg text-muted-foreground sm:inline">
            Remorseless Records
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-xs font-semibold uppercase tracking-[0.35rem] text-muted-foreground transition hover:text-destructive",
                activeHref === link.href && "text-destructive"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/cart" aria-label="View cart">
            <Button variant="ghost" size="icon" className="relative">
              <ShoppingCart className="h-5 w-5" />
              {hasItems ? (
                <Badge className="absolute -right-2 -top-2 h-5 w-5 justify-center rounded-full bg-destructive text-[0.65rem] text-white">
                  {itemCount}
                </Badge>
              ) : null}
            </Button>
          </Link>
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
                      className={cn(
                        "rounded-full border border-border/60 px-4 py-3 text-xs font-semibold uppercase tracking-[0.35rem] text-muted-foreground transition hover:border-destructive hover:text-destructive",
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
                    className="inline-flex items-center justify-between rounded-full border border-border/60 px-4 py-3 text-xs font-semibold uppercase tracking-[0.35rem] text-muted-foreground transition hover:border-destructive hover:text-destructive"
                  >
                    <span>Cart</span>
                    <span className="rounded-full bg-destructive px-3 py-1 text-[0.6rem] text-white">
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
    </header>
  )
}

export default SiteHeaderShell
