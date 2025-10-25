"use client"

import { useEffect, useState, useTransition } from "react"
import { Dialog } from "radix-ui"
import { Search, X } from "lucide-react"

import ProductSearchExperience from "@/components/product-search-experience"
import { searchProductsBrowser } from "@/lib/search/browser"
import type { ProductSearchResponse } from "@/lib/search/search"
import { useUIStore } from "@/lib/store/ui"

type SearchModalProps = {
  children: React.ReactNode
}

const SearchModal = ({ children }: SearchModalProps) => {
  const open = useUIStore((state) => state.isSearchOpen)
  const setOpen = useUIStore((state) => state.setSearchOpen)
  const [isPending, startTransition] = useTransition()
  const [initial, setInitial] = useState<ProductSearchResponse | null>(null)

  useEffect(() => {
    if (!open || initial || isPending) {
      return
    }

    startTransition(async () => {
      try {
        const response = await searchProductsBrowser({ query: "", limit: 12 })
        setInitial(response)
      } catch (cause: unknown) {
        console.error("Preloading search failed", cause)
      }
    })
  }, [open, initial, isPending])

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
        <Dialog.Content className="fixed inset-x-0 top-[5vh] z-50 mx-auto flex w-[min(95vw,960px)] flex-col gap-6 rounded-3xl border border-border/70 bg-background/97 px-6 py-6 shadow-glow data-[state=open]:animate-in data-[state=open]:zoom-in-90 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 sm:px-8 sm:py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm uppercase tracking-[0.3rem] text-muted-foreground">
              <Search className="h-4 w-4" />
              <span>Search the Catalog</span>
            </div>
            <Dialog.Close
              className="rounded-full border border-border/60 p-2 text-muted-foreground transition hover:border-accent hover:text-accent"
              aria-label="Close search"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {initial ? (
            <ProductSearchExperience
              initialHits={initial.hits}
              initialFacets={initial.facets}
              initialTotal={initial.total}
              pageSize={12}
            />
          ) : (
            (() => {
              const skeletonKeys = ["one", "two", "three", "four"]
              return (
            <div className="grid gap-4">
              <div className="h-10 rounded-full skeleton" />
              <div className="grid gap-3 sm:grid-cols-2">
                {skeletonKeys.map((key) => (
                  <div
                    key={`search-skeleton-${key}`}
                    className="h-32 rounded-2xl border border-border/60 bg-background/60 skeleton"
                  />
                ))}
              </div>
            </div>
              )
            })()
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default SearchModal
