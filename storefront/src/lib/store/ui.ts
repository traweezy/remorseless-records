import { createStore } from "zustand/vanilla"
import { useStoreWithEqualityFn } from "zustand/traditional"
import { shallow } from "zustand/shallow"

export type UIStoreState = {
  isSearchOpen: boolean
  setSearchOpen: (open: boolean) => void
  isMenuOpen: boolean
  setMenuOpen: (open: boolean) => void
}

const uiStoreBase = createStore<UIStoreState>()((set) => ({
  isSearchOpen: false,
  setSearchOpen: (open: boolean) =>
    set((state) =>
      state.isSearchOpen === open ? state : { ...state, isSearchOpen: open }
    ),
  isMenuOpen: false,
  setMenuOpen: (open: boolean) =>
    set((state) =>
      state.isMenuOpen === open ? state : { ...state, isMenuOpen: open }
    ),
}))

export const useUIStore = <T,>(selector: (state: UIStoreState) => T): T =>
  useStoreWithEqualityFn(uiStoreBase, selector, shallow)

export const uiStore = uiStoreBase
