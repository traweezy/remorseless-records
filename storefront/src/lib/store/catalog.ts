import { useStoreWithEqualityFn, createWithEqualityFn } from "zustand/traditional"
import { shallow } from "zustand/shallow"
import { immer } from "zustand/middleware/immer"
import { devtools } from "zustand/middleware"
import type { ProductSortOption } from "@/lib/search/search"

type FilterState = {
  query: string
  genres: string[]
  artists: string[]
  formats: string[]
  productTypes: string[]
  showInStockOnly: boolean
  sort: ProductSortOption
}

type FilterActions = {
  setQuery: (value: string) => void
  toggleGenre: (handle: string) => void
  toggleArtist: (artist: string) => void
  toggleFormat: (value: string) => void
  toggleProductType: (value: string) => void
  toggleStockOnly: () => void
  setSort: (value: ProductSortOption) => void
  clearFilters: () => void
  hydrateFromParams: (params: Partial<FilterState>) => void
}

export type CatalogStoreState = FilterState & FilterActions

const initialState: FilterState = {
  query: "",
  genres: [],
  artists: [],
  formats: [],
  productTypes: [],
  showInStockOnly: false,
  sort: "alphabetical",
}

const catalogStoreBase = createWithEqualityFn<CatalogStoreState>()(
  devtools(
    immer((set) => ({
      ...initialState,
      setQuery: (value) =>
        set((state) => {
          state.query = value
        }),
      toggleGenre: (handle) =>
        set((state) => {
          const normalized = handle.trim().toLowerCase()
          if (!normalized.length) return
          if (state.genres.includes(normalized)) {
            state.genres = state.genres.filter((entry: string) => entry !== normalized)
          } else {
            state.genres.push(normalized)
          }
        }),
      toggleArtist: (artist) =>
        set((state) => {
          const normalized = artist.trim().toLowerCase()
          if (!normalized.length) return
          if (state.artists.includes(normalized)) {
            state.artists = state.artists.filter((entry: string) => entry !== normalized)
          } else {
            state.artists.push(normalized)
          }
        }),
      toggleFormat: (value) =>
        set((state) => {
          if (state.formats.includes(value)) {
            state.formats = state.formats.filter((entry: string) => entry !== value)
          } else {
            state.formats.push(value)
          }
        }),
      toggleProductType: (value) =>
        set((state) => {
          if (state.productTypes.includes(value)) {
            state.productTypes = state.productTypes.filter((entry: string) => entry !== value)
          } else {
            state.productTypes.push(value)
          }
        }),
      toggleStockOnly: () =>
        set((state) => {
          state.showInStockOnly = !state.showInStockOnly
        }),
      setSort: (value) =>
        set((state) => {
          state.sort = value
        }),
      clearFilters: () =>
        set((state) => {
          state.genres = []
          state.artists = []
          state.formats = []
          state.productTypes = []
          state.showInStockOnly = false
        }),
      hydrateFromParams: (params) =>
        set((state) => {
          state.query = params.query ?? state.query
          state.genres = params.genres ?? state.genres
          state.artists = params.artists ?? state.artists
          state.formats = params.formats ?? state.formats
          state.productTypes = params.productTypes ?? state.productTypes
          state.showInStockOnly =
            params.showInStockOnly ?? state.showInStockOnly
          state.sort = params.sort ?? state.sort
        }),
    }))
  )
)

type SelectorFn<T> = (state: CatalogStoreState) => T

export const useCatalogStore = <T,>(
  selector: SelectorFn<T>,
  equalityFn = shallow
): T => useStoreWithEqualityFn(catalogStoreBase, selector, equalityFn)

export const catalogStore = catalogStoreBase
