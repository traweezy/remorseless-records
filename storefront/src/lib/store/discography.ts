import { createStore } from "zustand/vanilla"
import { useStoreWithEqualityFn } from "zustand/traditional"
import { shallow } from "zustand/shallow"
import type { DiscographyAvailability } from "@/lib/data/discography"

export type DiscographySort =
  | "catalog-desc"
  | "title-asc"
  | "title-desc"
  | "artist-asc"
  | "newest"
  | "oldest"

type DiscographyState = {
  query: string
  availability: DiscographyAvailability | ""
  format: string
  tag: string
  sort: DiscographySort
  setQuery: (query: string) => void
  setAvailability: (availability: DiscographyAvailability | "") => void
  setFormat: (format: string) => void
  setTag: (tag: string) => void
  setSort: (sort: DiscographySort) => void
  clearFilters: () => void
}

// Public browsing state survives client navigation, like the Catalog store.
// Keep it in this tab's memory; do not persist it to browser storage.
const discographyStore = createStore<DiscographyState>()((set) => ({
  query: "",
  availability: "",
  format: "",
  tag: "",
  sort: "catalog-desc",
  setQuery: (query) => set({ query }),
  setAvailability: (availability) => set({ availability }),
  setFormat: (format) => set({ format }),
  setTag: (tag) => set({ tag }),
  setSort: (sort) => set({ sort }),
  clearFilters: () => set({ availability: "", format: "", tag: "" }),
}))

export const useDiscographyStore = <T>(
  selector: (state: DiscographyState) => T
): T => useStoreWithEqualityFn(discographyStore, selector, shallow)
