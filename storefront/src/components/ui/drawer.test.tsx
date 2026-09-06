import { StrictMode, type ComponentProps } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import Drawer, { DrawerCloseButton } from "@/components/ui/drawer"

type AutoFocusHandlers = Pick<
  ComponentProps<typeof Drawer>,
  "onOpenAutoFocus" | "onCloseAutoFocus" | "side"
>

const renderControlledDrawer = (handlers: AutoFocusHandlers = {}) => {
  const onOpenChange = vi.fn()
  let showOpener = true
  let showDrawer = true
  const ui = (open: boolean) => (
    <StrictMode>
      {showOpener ? (
        <button key="opener" type="button">
          Open drawer
        </button>
      ) : null}
      <button key="other" type="button">
        Another control
      </button>
      {showDrawer ? (
        <Drawer
          open={open}
          onOpenChange={onOpenChange}
          ariaLabel="Test drawer"
          {...handlers}
        >
          <DrawerCloseButton />
        </Drawer>
      ) : null}
    </StrictMode>
  )
  const result = render(ui(false))
  const opener = screen.getByRole("button", { name: "Open drawer" })
  const other = screen.getByRole("button", { name: "Another control" })
  opener.focus()
  return {
    opener,
    other,
    open: () => result.rerender(ui(true)),
    close: () => result.rerender(ui(false)),
    removeOpener: () => {
      showOpener = false
      result.rerender(ui(true))
    },
    unmountDrawer: () => {
      showDrawer = false
      result.rerender(ui(true))
    },
  }
}

const expectOpenFocus = async (): Promise<void> => {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Close drawer" })).toHaveFocus()
  )
}

const expectClosed = async (): Promise<void> => {
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Test drawer" })).toBeNull()
  )
  // Radix dispatches its close-auto-focus event in the next task.
  await new Promise<void>((resolve) => setTimeout(resolve, 10))
}

describe("controlled Drawer focus", () => {
  afterEach(cleanup)

  it("restores each real opener after close and reopen in StrictMode", async () => {
    const drawer = renderControlledDrawer()
    drawer.open()
    await expectOpenFocus()
    drawer.close()
    await waitFor(() => expect(drawer.opener).toHaveFocus())
    drawer.other.focus()
    drawer.open()
    await expectOpenFocus()
    drawer.close()
    await waitFor(() => expect(drawer.other).toHaveFocus())
  })

  it("restores focus for the left-side filter drawer variant", async () => {
    const drawer = renderControlledDrawer({ side: "left" })
    drawer.open()
    await expectOpenFocus()
    expect(screen.getByRole("dialog", { name: "Test drawer" })).toHaveClass(
      "left-0",
      "border-r"
    )
    drawer.close()
    await waitFor(() => expect(drawer.opener).toHaveFocus())
  })

  it("restores opacity-hidden affordances that become visible on focus", async () => {
    const drawer = renderControlledDrawer()
    drawer.open()
    await expectOpenFocus()
    // Quick Shop is revealed by :focus-within, so opacity is not a measure
    // of whether its opener can receive focus again.
    Object.defineProperty(drawer.opener, "checkVisibility", {
      configurable: true,
      value: (options?: { checkOpacity?: boolean }) => !options?.checkOpacity,
    })
    drawer.close()
    await waitFor(() => expect(drawer.opener).toHaveFocus())
  })

  it.each(["removed", "disabled", "hidden"] as const)(
    "does not restore an opener that became %s",
    async (state) => {
      const drawer = renderControlledDrawer()
      drawer.open()
      await expectOpenFocus()
      const focus = vi.spyOn(drawer.opener, "focus")
      if (state === "removed") drawer.removeOpener()
      if (state === "disabled") drawer.opener.setAttribute("disabled", "")
      if (state === "hidden") drawer.opener.hidden = true
      drawer.close()
      await expectClosed()
      expect(focus).not.toHaveBeenCalled()
    }
  )

  it("honors consumer autofocus cancellation and intentional focus", async () => {
    const onOpenAutoFocus = vi.fn((event: Event) => event.preventDefault())
    const onCloseAutoFocus = vi.fn((event: Event) => {
      event.preventDefault()
      drawer.other.focus()
    })
    const drawer = renderControlledDrawer({ onOpenAutoFocus, onCloseAutoFocus })
    drawer.open()
    await waitFor(() => expect(onOpenAutoFocus).toHaveBeenCalled())
    drawer.close()
    await expectClosed()
    expect(onCloseAutoFocus).toHaveBeenCalled()
    expect(drawer.other).toHaveFocus()
  })

  it("does not steal focus moved outside after the close transition", async () => {
    const drawer = renderControlledDrawer()
    drawer.open()
    await expectOpenFocus()
    drawer.close()
    drawer.other.focus()
    await expectClosed()
    expect(drawer.other).toHaveFocus()
  })

  it("does not restore the opener after navigation", async () => {
    const href = window.location.href
    const drawer = renderControlledDrawer()
    drawer.open()
    await expectOpenFocus()
    const focus = vi.spyOn(drawer.opener, "focus")
    try {
      window.history.replaceState(null, "", "/drawer-focus-destination")
      drawer.close()
      await expectClosed()
      expect(focus).not.toHaveBeenCalled()
    } finally {
      window.history.replaceState(null, "", href)
    }
  })

  it("keeps focus inside a drawer when close is superseded by reopen", async () => {
    const drawer = renderControlledDrawer()
    drawer.open()
    await expectOpenFocus()
    drawer.close()
    drawer.open()
    await expectOpenFocus()
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    expect(screen.getByRole("button", { name: "Close drawer" })).toHaveFocus()
    drawer.close()
    await waitFor(() => expect(drawer.opener).toHaveFocus())
  })

  it("restores a connected opener when the open drawer unmounts", async () => {
    const drawer = renderControlledDrawer()
    drawer.open()
    await expectOpenFocus()
    drawer.unmountDrawer()
    await waitFor(() => expect(drawer.opener).toHaveFocus())
  })

  it("restores nested controlled drawers to their own openers", async () => {
    const onOpenChange = vi.fn()
    const ui = (parentOpen: boolean, childOpen: boolean) => (
      <StrictMode>
        <button type="button">Open parent</button>
        <Drawer
          open={parentOpen}
          onOpenChange={onOpenChange}
          ariaLabel="Parent"
        >
          <button type="button">Open child</button>
          <Drawer
            open={childOpen}
            onOpenChange={onOpenChange}
            ariaLabel="Child"
          >
            <DrawerCloseButton label="Close child" />
          </Drawer>
        </Drawer>
      </StrictMode>
    )
    const result = render(ui(false, false))
    const parentOpener = screen.getByRole("button", { name: "Open parent" })
    parentOpener.focus()
    result.rerender(ui(true, false))
    const childOpener = screen.getByRole("button", { name: "Open child" })
    await waitFor(() => expect(childOpener).toHaveFocus())
    result.rerender(ui(true, true))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Close child" })).toHaveFocus()
    )
    result.rerender(ui(true, false))
    await waitFor(() => expect(childOpener).toHaveFocus())
    result.rerender(ui(false, false))
    await waitFor(() => expect(parentOpener).toHaveFocus())
  })
})
