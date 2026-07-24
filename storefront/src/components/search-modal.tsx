"use client"

import { useEffect, useState, useTransition } from "react"
import { Search } from "lucide-react"

import ProductSearchExperience from "@/components/product-search-experience"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
        const response = await searchProductsBrowser({
          query: "",
          limit: 12,
          offset: 0,
          sort: "title-asc",
        })
        setInitial(response)
      } catch (cause: unknown) {
        console.error("Preloading search failed", cause)
      }
    })
  }, [open, initial, isPending])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        closeLabel="Close search"
        className="inset-x-0 left-0 top-[5vh] mx-auto flex w-[min(95vw,960px)] translate-x-0 translate-y-0 flex-col gap-6 bg-background/97 px-6 py-6 data-[state=open]:zoom-in-90 data-[state=closed]:zoom-out-95 sm:px-8 sm:py-8"
      >
        <div className="flex items-center justify-between pr-12">
          <DialogTitle className="flex items-center gap-3 font-sans text-sm uppercase tracking-[0.3rem] text-muted-foreground">
            <Search className="h-4 w-4" />
            <span>Search the Catalog</span>
          </DialogTitle>
        </div>

        {initial ? (
          <ProductSearchExperience
            initialResponse={initial}
            initialSort="title-asc"
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
      </DialogContent>
    </Dialog>
  )
}

export default SearchModal
