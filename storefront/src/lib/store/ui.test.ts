import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

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

  it("notifies once per actual change and stops after unsubscribe", () => {
    uiStore.getState().setSearchOpen(false)
    uiStore.getState().setMenuOpen(false)
    const before = uiStore.getState()
    const listener = vi.fn()
    const unsubscribe = uiStore.subscribe(listener)
    try {
      before.setMenuOpen(false)
      before.setSearchOpen(false)
      expect(listener).not.toHaveBeenCalled()
      expect(uiStore.getState()).toBe(before)

      before.setSearchOpen(true)
      const after = uiStore.getState()
      expect(listener).toHaveBeenCalledExactlyOnceWith(after, before)
      expect(after.setSearchOpen).toBe(before.setSearchOpen)
      expect(after.setMenuOpen).toBe(before.setMenuOpen)
      expect(before.isSearchOpen).toBe(false)
    } finally {
      unsubscribe()
    }
    uiStore.getState().setSearchOpen(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
