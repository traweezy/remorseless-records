import { faker } from "@faker-js/faker"
import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useProximityPrefetch } from "@/hooks/useProximityPrefetch"
import { shouldBlockPrefetch } from "@/lib/prefetch"

const prefetchMock = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: prefetchMock,
  }),
}))

vi.mock("@/lib/prefetch", () => ({
  shouldBlockPrefetch: vi.fn(),
}))

const TestHook = ({ radius }: { radius?: number }) => {
  const options = radius === undefined ? {} : { radius }
  useProximityPrefetch(options)
  return null
}

describe("useProximityPrefetch", () => {
  beforeEach(() => {
    faker.seed(3401)
    prefetchMock.mockReset()
    vi.mocked(shouldBlockPrefetch).mockReturnValue(false)
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    document.body.innerHTML = ""
  })

  it("prefetches nearby anchor href once", () => {
    const href = faker.internet.url()
    const anchor = document.createElement("a")
    anchor.setAttribute("href", href)
    anchor.setAttribute("data-prefetch", "true")
    anchor.getBoundingClientRect = () =>
      ({
        left: 10,
        right: 100,
        top: 10,
        bottom: 100,
      } as DOMRect)
    document.body.appendChild(anchor)

    render(<TestHook radius={faker.number.int({ min: 100, max: 300 })} />)
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 20, clientY: 20 }))
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 20, clientY: 20 }))

    expect(prefetchMock).toHaveBeenCalledTimes(1)
    expect(prefetchMock).toHaveBeenCalledWith(href, { kind: "full" })
  })

  it("skips prefetch when blocked or outside radius", () => {
    const href = faker.internet.url()
    const anchor = document.createElement("a")
    anchor.setAttribute("href", href)
    anchor.setAttribute("data-prefetch", "true")
    anchor.getBoundingClientRect = () =>
      ({
        left: 500,
        right: 600,
        top: 500,
        bottom: 600,
      } as DOMRect)
    document.body.appendChild(anchor)

    render(<TestHook radius={50} />)
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 0 }))
    expect(prefetchMock).not.toHaveBeenCalled()

    vi.mocked(shouldBlockPrefetch).mockReturnValue(true)
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 550, clientY: 550 }))
    expect(prefetchMock).not.toHaveBeenCalled()
  })

  it("swallows router.prefetch errors", () => {
    prefetchMock.mockImplementationOnce(() => {
      throw new Error("prefetch failure")
    })
    const href = faker.internet.url()
    const anchor = document.createElement("a")
    anchor.setAttribute("href", href)
    anchor.setAttribute("data-prefetch", "true")
    anchor.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 10,
        top: 0,
        bottom: 10,
      } as DOMRect)
    document.body.appendChild(anchor)

    render(<TestHook radius={25} />)
    expect(() =>
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 5 }))
    ).not.toThrow()
  })
})
