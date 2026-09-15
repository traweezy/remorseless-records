import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { Activity, StrictMode, type PropsWithChildren } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CheckoutConfirmation } from "@/features/checkout/components/checkout-confirmation"
import type { CheckoutReceipt } from "@/features/checkout/types/checkout"

vi.mock("@/components/ui/smart-link", () => ({
  default: ({ children, href }: PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}))

const receipt = (name: string): CheckoutReceipt => ({
  orderNumber: name,
  placedAt: "2026-09-08T12:00:00.000Z",
  email: `${name}@example.test`,
  items: [
    {
      id: `item-${name}`,
      title: `Release ${name}`,
      variantTitle: "CD",
      thumbnail: null,
      quantity: 1,
      total: 15,
    },
  ],
  deliveryAddress: null,
  deliveryMethod: null,
  totals: {
    taxCollectionMode: "disabled",
    currencyCode: "usd",
    subtotal: 15,
    discountTotal: 0,
    shippingTotal: 0,
    taxTotal: 0,
    total: 15,
  },
})

const response = (name: string): Response =>
  Response.json({ receipt: receipt(name) })

const receiptProblem = (status: 404 | 503): Response =>
  Response.json(
    {
      type: `https://remorselessrecords.com/problems/receipt-${status === 404 ? "missing" : "unavailable"}`,
      title: "Receipt is unavailable",
      status,
      code: status === 404 ? "receipt_missing" : "receipt_unavailable",
      detail:
        status === 404
          ? "This secure receipt has expired. Check your email for the order confirmation."
          : "Your order is confirmed, but the receipt could not be loaded. Check your email or try again.",
    },
    { status }
  )

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const clients: QueryClient[] = []
const createClient = (): QueryClient => {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  })
  clients.push(client)
  return client
}

const mount = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <CheckoutConfirmation />
    </QueryClientProvider>
  )

const expectReceipt = async (name: string): Promise<void> => {
  expect(await screen.findByText(`${name}@example.test`)).toBeVisible()
  expect(screen.getByText(`Release ${name}`)).toBeVisible()
}

const expectNoReceipt = (name: string): void => {
  expect(screen.queryByText(`${name}@example.test`)).not.toBeInTheDocument()
  expect(screen.queryByText(`Release ${name}`)).not.toBeInTheDocument()
}

afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
  onlineManager.setOnline(true)
  vi.unstubAllGlobals()
})

describe("CheckoutConfirmation receipt authority", () => {
  it.each([true, false])(
    "renders the authorized delivery, artwork and collected totals with optional delivery details %s",
    async (withDetails) => {
      const current = receipt("delivery")
      current.orderNumber = null
      current.deliveryAddress = {
        firstName: "Synthetic",
        lastName: "Customer",
        address1: "123 Fixture Street",
        address2: withDetails ? "Unit 4" : null,
        city: "Phoenix",
        province: "AZ",
        postalCode: "85001",
        countryCode: "us",
      }
      current.deliveryMethod = withDetails ? "Tracked delivery" : null
      current.items = current.items.map((item) => ({
        ...item,
        thumbnail: "/receipt-fixture.webp",
        variantTitle: null,
      }))
      current.totals = {
        ...current.totals,
        discountTotal: 1,
        shippingTotal: 3,
        taxTotal: 1,
        total: 18,
        taxCollectionMode: "collect",
      }
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(Response.json({ receipt: current })))
      )
      mount(createClient())
      await expectReceipt("delivery")
      expect(screen.getByRole("heading", { name: "Delivery" })).toBeVisible()
      expect(screen.getByText("Synthetic Customer")).toBeVisible()
      expect(screen.getByText("123 Fixture Street")).toBeVisible()
      expect(screen.getByAltText("")).toHaveAttribute("sizes", "56px")
      expect(screen.getByText("Qty 1")).toBeVisible()
      expect(screen.getByText("Discount")).toBeVisible()
      expect(screen.getByText("−$1.00")).toBeVisible()
      expect(screen.getByText("Tax", { exact: true })).toBeVisible()
      expect(screen.getByText("$18.00")).toBeVisible()
      expect(screen.queryByText(/Order #/)).not.toBeInTheDocument()
      if (withDetails) {
        expect(screen.getByText("Unit 4")).toBeVisible()
        expect(screen.getByText("Tracked delivery")).toBeVisible()
      } else {
        expect(screen.queryByText("Unit 4")).not.toBeInTheDocument()
        expect(screen.queryByText("Tracked delivery")).not.toBeInTheDocument()
      }
    }
  )

  it("reauthorizes a second visit with one persistent client without displaying the previous order", async () => {
    const client = createClient()
    const second = deferred<Response>()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("first"))
      .mockReturnValueOnce(second.promise)
    vi.stubGlobal("fetch", fetchMock)

    const firstVisit = mount(client)
    await expectReceipt("first")
    expect(client.getQueryCache().getAll()[0]?.meta).toEqual({ persist: false })
    firstVisit.unmount()
    expect(client.getQueryCache().getAll()).toHaveLength(0)

    mount(client)
    expect(screen.getByText("Loading order receipt…")).toBeVisible()
    expectNoReceipt("first")
    await act(async () => {
      second.resolve(response("second"))
    })
    await expectReceipt("second")
    expectNoReceipt("first")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/checkout/confirmation",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
        signal: expect.any(AbortSignal),
      })
    )
  })

  it("does not consume legacy shared receipt data", async () => {
    const client = createClient()
    client.setQueryData(["checkout", "confirmation"], receipt("previous"))
    const pending = deferred<Response>()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => pending.promise)
    )

    mount(client)
    expectNoReceipt("previous")
    expect(screen.getByText("Loading order receipt…")).toBeVisible()
    await act(async () => {
      pending.resolve(response("current"))
    })
    await expectReceipt("current")
  })

  it.each([404, 503] as const)(
    "hides retained receipt data during and after a failed %s revalidation, then permits a fresh retry",
    async (status) => {
      const client = createClient()
      const pending = deferred<Response>()
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response("previous"))
        .mockReturnValueOnce(pending.promise)
        .mockImplementation(() => Promise.resolve(receiptProblem(status)))
      vi.stubGlobal("fetch", fetchMock)
      mount(client)
      await expectReceipt("previous")

      let refreshing!: Promise<void>
      await act(async () => {
        refreshing = client.refetchQueries({
          queryKey: ["checkout", "confirmation"],
        })
      })
      await waitFor(() =>
        expect(screen.getByText("Loading order receipt…")).toBeVisible()
      )
      expectNoReceipt("previous")
      await act(async () => {
        pending.resolve(receiptProblem(status))
        await refreshing
      })
      expect(await screen.findByRole("alert")).toHaveTextContent(
        status === 404
          ? "This secure receipt has expired. Check your email"
          : "Your order is confirmed, but the receipt could not be loaded"
      )
      expectNoReceipt("previous")
      expect(client.getQueryCache().getAll()[0]?.state.data).toBeUndefined()
      expect(client.getQueryCache().getAll()[0]?.state.status).toBe("error")
      fetchMock.mockResolvedValueOnce(response("current"))
      fireEvent.click(screen.getByRole("button", { name: "Try again" }))
      await expectReceipt("current")
      expectNoReceipt("previous")
    }
  )

  it("clears the cached receipt after a network failure without an automatic refetch loop", async () => {
    const client = createClient()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("previous"))
      .mockRejectedValue(new TypeError("synthetic network failure"))
    vi.stubGlobal("fetch", fetchMock)
    mount(client)
    await expectReceipt("previous")
    await act(async () => {
      await client.refetchQueries({ queryKey: ["checkout", "confirmation"] })
    })
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Checkout could not be reached"
    )
    expectNoReceipt("previous")
    expect(client.getQueryCache().getAll()[0]?.state.data).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("does not reveal the cached receipt while offline reauthorization is paused", async () => {
    const client = createClient()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("previous"))
      .mockResolvedValueOnce(response("current"))
    vi.stubGlobal("fetch", fetchMock)
    mount(client)
    await expectReceipt("previous")
    let refreshing!: Promise<void>
    await act(async () => {
      onlineManager.setOnline(false)
      refreshing = client.refetchQueries({
        queryKey: ["checkout", "confirmation"],
      })
    })
    await waitFor(() =>
      expect(screen.getByText("Loading order receipt…")).toBeVisible()
    )
    expect(client.getQueryCache().getAll()[0]?.state.fetchStatus).toBe("paused")
    expectNoReceipt("previous")
    await act(async () => {
      onlineManager.setOnline(true)
      await refreshing
    })
    await expectReceipt("current")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("removes and reauthorizes a receipt when Activity hides and reveals the same component state", async () => {
    const client = createClient()
    const pending = deferred<Response>()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("previous"))
      .mockReturnValueOnce(pending.promise)
    vi.stubGlobal("fetch", fetchMock)
    const view = (mode: "visible" | "hidden") => (
      <QueryClientProvider client={client}>
        <Activity mode={mode}>
          <CheckoutConfirmation />
        </Activity>
      </QueryClientProvider>
    )
    const mounted = render(view("visible"))
    await expectReceipt("previous")
    mounted.rerender(view("hidden"))
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    mounted.rerender(view("visible"))
    expectNoReceipt("previous")
    expect(screen.getByText("Loading order receipt…")).toBeVisible()
    await act(async () => {
      pending.resolve(response("current"))
    })
    await expectReceipt("current")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(["unmount", "activity"] as const)(
    "aborts a pending receipt on %s and discards its late body after the next visit",
    async (boundary) => {
      const client = createClient()
      const oldBody = deferred<unknown>()
      const readingBody = deferred<void>()
      const signals: AbortSignal[] = []
      let calls = 0
      vi.stubGlobal(
        "fetch",
        vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.signal) signals.push(init.signal)
          calls += 1
          return calls === 1
            ? Promise.resolve({
                ok: true,
                json: () => {
                  readingBody.resolve()
                  return oldBody.promise
                },
              } as Response)
            : Promise.resolve(response("current"))
        })
      )
      const view = (mode: "visible" | "hidden") => (
        <QueryClientProvider client={client}>
          <Activity mode={mode}>
            <CheckoutConfirmation />
          </Activity>
        </QueryClientProvider>
      )
      const mounted = render(view("visible"))
      await act(async () => {
        await readingBody.promise
      })
      if (boundary === "activity") mounted.rerender(view("hidden"))
      else mounted.unmount()
      expect(signals[0]?.aborted).toBe(true)
      expect(client.getQueryCache().getAll()).toHaveLength(0)
      if (boundary === "activity") mounted.rerender(view("visible"))
      else mount(client)
      await expectReceipt("current")
      await act(async () => {
        oldBody.resolve({ receipt: receipt("previous") })
      })
      expectNoReceipt("previous")
      expect(client.getQueryCache().getAll()).toHaveLength(1)
      expect(client.getQueryCache().getAll()[0]?.state.data).toEqual(
        receipt("current")
      )
      expect(signals[1]?.aborted).toBe(false)
    }
  )

  it("reauthorizes after StrictMode cleanup without reusing a canceled request", async () => {
    const client = createClient()
    const signals: AbortSignal[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal)
        return Promise.resolve(
          response(signals.length === 1 ? "previous" : "current")
        )
      })
    )
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <CheckoutConfirmation />
        </QueryClientProvider>
      </StrictMode>
    )
    await expectReceipt("current")
    expectNoReceipt("previous")
    expect(signals[0]?.aborted).toBe(true)
    expect(signals.at(-1)?.aborted).toBe(false)
    expect(client.getQueryCache().getAll()).toHaveLength(1)
  })
})
