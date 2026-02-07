import { faker } from "@faker-js/faker"
import { fireEvent, render, screen } from "@testing-library/react"
import React, { createRef } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SmartLink } from "@/components/ui/smart-link"
import { shouldBlockPrefetch } from "@/lib/prefetch"

const prefetchMock = vi.fn()

type ObserverRecord = {
  callback: IntersectionObserverCallback
  options: IntersectionObserverInit | null
  observe: (target: Element) => void
  disconnect: () => void
  observeSpy: ReturnType<typeof vi.fn>
  disconnectSpy: ReturnType<typeof vi.fn>
}

const observers: ObserverRecord[] = []

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: prefetchMock,
  }),
}))

vi.mock("next/link", () => ({
  default: React.forwardRef<
    HTMLAnchorElement,
    React.ComponentPropsWithoutRef<"a"> & { href: string; prefetch?: boolean }
  >(({ href, children, prefetch: _prefetch, ...rest }, ref) => (
    <a ref={ref} href={href} {...rest}>
      {children}
    </a>
  )),
}))

vi.mock("@/lib/prefetch", () => ({
  shouldBlockPrefetch: vi.fn(),
}))

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin: string
  readonly thresholds: ReadonlyArray<number> = []
  observe: (target: Element) => void
  disconnect: () => void

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.rootMargin = options?.rootMargin ?? "0px"
    const observeSpy = vi.fn()
    const disconnectSpy = vi.fn()
    const observe = (target: Element) => {
      observeSpy(target)
    }
    const disconnect = () => {
      disconnectSpy()
    }
    const record: ObserverRecord = {
      callback,
      options: options ?? null,
      observe,
      disconnect,
      observeSpy,
      disconnectSpy,
    }
    observers.push(record)
    this.observe = record.observe
    this.disconnect = record.disconnect
  }

  takeRecords = () => []
  unobserve = vi.fn()
}

describe("SmartLink", () => {
  beforeEach(() => {
    faker.seed(3301)
    prefetchMock.mockReset()
    prefetchMock.mockResolvedValue(undefined)
    observers.length = 0
    vi.mocked(shouldBlockPrefetch).mockReturnValue(false)
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)
  })

  it("renders normalized href and forwards refs", () => {
    const href = `${faker.internet.url()}  `
    const ref = createRef<HTMLAnchorElement>()
    render(<SmartLink href={href}>Open</SmartLink>, { wrapper: ({ children }) => <>{children}</> })

    const link = screen.getByRole("link", { name: "Open" })
    expect(link).toHaveAttribute("href", href.trim())
    expect(link).toHaveAttribute("data-prefetch", "true")

    render(<SmartLink href={href} ref={ref}>Open 2</SmartLink>)
    expect(ref.current).toBe(screen.getByRole("link", { name: "Open 2" }))
  })

  it("prefetches once on hover and focus", () => {
    const href = faker.internet.url()
    render(<SmartLink href={href}>Prefetch</SmartLink>)
    const link = screen.getByRole("link", { name: "Prefetch" })

    fireEvent.mouseEnter(link)
    fireEvent.focus(link)

    expect(prefetchMock).toHaveBeenCalledTimes(1)
    expect(prefetchMock).toHaveBeenCalledWith(href, { kind: "full" })
  })

  it("skips prefetch when blocked or href is empty", () => {
    vi.mocked(shouldBlockPrefetch).mockReturnValue(true)
    render(<SmartLink href={"   "}>Blocked</SmartLink>)
    const link = screen.getByText("Blocked")
    fireEvent.mouseEnter(link)
    expect(prefetchMock).not.toHaveBeenCalled()
  })

  it("prefetches via intersection observer and disconnects", () => {
    const href = faker.internet.url()
    render(
      <SmartLink href={href} preloadOffset={faker.number.int({ min: 120, max: 320 })}>
        Observe
      </SmartLink>
    )

    const observer = observers[0]
    expect(observer).toBeDefined()
    expect(observer?.observeSpy).toHaveBeenCalled()

    observer?.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )

    expect(prefetchMock).toHaveBeenCalledTimes(1)
    expect(observer?.disconnectSpy).toHaveBeenCalled()
  })

  it("does not prefetch from observer when entry is not intersecting", () => {
    const href = faker.internet.url()
    render(<SmartLink href={href}>Observe miss</SmartLink>)
    const observer = observers[0]

    observer?.callback(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )

    expect(prefetchMock).not.toHaveBeenCalled()
    expect(observer?.disconnectSpy).not.toHaveBeenCalled()
  })

  it("respects disabled proximity and forwards event handlers", () => {
    const href = faker.internet.url()
    const onMouseEnter = vi.fn()
    const onFocus = vi.fn()

    render(
      <SmartLink
        href={href}
        enableProximity={false}
        onMouseEnter={onMouseEnter}
        onFocus={onFocus}
      >
        No Observe
      </SmartLink>
    )
    const link = screen.getByRole("link", { name: "No Observe" })
    fireEvent.mouseEnter(link)
    fireEvent.focus(link)

    expect(observers).toHaveLength(0)
    expect(link).toHaveAttribute("data-prefetch", "false")
    expect(onMouseEnter).toHaveBeenCalledTimes(1)
    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(prefetchMock).toHaveBeenCalledTimes(1)
  })

  it("catches rejected prefetch promises without throwing", () => {
    prefetchMock.mockRejectedValueOnce(new Error("network"))
    const href = faker.internet.url()
    render(<SmartLink href={href}>Reject</SmartLink>)
    const link = screen.getByRole("link", { name: "Reject" })

    expect(() => fireEvent.mouseEnter(link)).not.toThrow()
  })
})
