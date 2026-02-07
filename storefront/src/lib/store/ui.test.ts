import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it } from "vitest"

import { uiStore } from "@/lib/store/ui"

describe("uiStore", () => {
  beforeEach(() => {
    faker.seed(2801)
  })

  it("updates search state only when value changes", () => {
    uiStore.setState({
      isSearchOpen: false,
      isMenuOpen: false,
      setSearchOpen: uiStore.getState().setSearchOpen,
      setMenuOpen: uiStore.getState().setMenuOpen,
    })

    uiStore.getState().setSearchOpen(true)
    expect(uiStore.getState().isSearchOpen).toBe(true)

    const before = uiStore.getState()
    uiStore.getState().setSearchOpen(true)
    expect(uiStore.getState()).toBe(before)

    uiStore.getState().setSearchOpen(false)
    expect(uiStore.getState().isSearchOpen).toBe(false)
  })

  it("updates menu state only when value changes", () => {
    uiStore.getState().setMenuOpen(true)
    expect(uiStore.getState().isMenuOpen).toBe(true)

    const before = uiStore.getState()
    uiStore.getState().setMenuOpen(true)
    expect(uiStore.getState()).toBe(before)

    uiStore.getState().setMenuOpen(false)
    expect(uiStore.getState().isMenuOpen).toBe(false)
  })
})
