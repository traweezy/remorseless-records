import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CheckoutApiError,
  completeCheckout,
  getCheckout,
  getCheckoutShippingOptions,
  prepareCheckoutPayment,
  saveCheckoutContact,
  saveCheckoutDelivery,
  saveCheckoutShippingMethod,
  type CheckoutCompletion,
} from "@/features/checkout/api/checkout-api"
import {
  CHECKOUT_QUERY_KEY,
  useCheckout,
} from "@/features/checkout/hooks/use-checkout"
import type {
  CheckoutProjection,
  CheckoutShippingOption,
} from "@/features/checkout/types/checkout"

vi.mock("@/features/checkout/api/checkout-api", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/features/checkout/api/checkout-api")
    >()
  return {
    ...actual,
    completeCheckout: vi.fn(),
    getCheckout: vi.fn(),
    getCheckoutShippingOptions: vi.fn(),
    prepareCheckoutPayment: vi.fn(),
    saveCheckoutContact: vi.fn(),
    saveCheckoutDelivery: vi.fn(),
    saveCheckoutShippingMethod: vi.fn(),
  }
})

const checkout = (revision = "a"): CheckoutProjection => ({
  state: "ready_for_payment",
  revision: `v1.${revision.repeat(43)}`,
  cart: {
    items: [],
    totals: {
      taxCollectionMode: "collect",
      currencyCode: "usd",
      subtotal: 10,
      discountTotal: 0,
      shippingTotal: 5,
      taxTotal: 0,
      total: 15,
    },
    contact: { email: "fixture@example.test" },
    deliveryAddress: null,
    shippingMethod: null,
  },
  payment: {
    provider: "stripe",
    clientSecret: null,
    status: "pending",
    canRestart: false,
  },
  confirmation: null,
})

const withAddress = (revision = "a"): CheckoutProjection => {
  const value = checkout(revision)
  return {
    ...value,
    cart: {
      ...value.cart,
      deliveryAddress: {
        firstName: "Fixture",
        lastName: "Buyer",
        address1: "123 Test Street",
        address2: null,
        city: "Test City",
        province: "NY",
        postalCode: "10001",
        countryCode: "us",
        phone: null,
      },
    },
  }
}

const shippingOption = (id: string): CheckoutShippingOption => ({
  id,
  name: id,
  description: null,
  amount: 5,
  currencyCode: "usd",
  insufficientInventory: false,
})

const clients: QueryClient[] = []
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const mountCheckout = (initial: CheckoutProjection) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  client.setQueryData(CHECKOUT_QUERY_KEY, initial)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(useCheckout, { wrapper }) }
}

beforeEach(() => {
  vi.mocked(getCheckout).mockReset().mockResolvedValue(checkout())
  vi.mocked(getCheckoutShippingOptions).mockReset().mockResolvedValue([])
  vi.mocked(saveCheckoutContact).mockReset()
  vi.mocked(saveCheckoutDelivery).mockReset()
  vi.mocked(prepareCheckoutPayment).mockReset()
  vi.mocked(completeCheckout).mockReset()
  vi.mocked(saveCheckoutShippingMethod).mockReset()
})

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
})

describe("checkout read/write ordering", () => {
  it("cancels a pre-existing read so it cannot overwrite a saved projection", async () => {
    const old = checkout()
    const saved = checkout("b")
    const delayed = deferred<CheckoutProjection>()
    vi.mocked(getCheckout).mockReturnValueOnce(delayed.promise)
    vi.mocked(saveCheckoutContact).mockResolvedValue(saved)
    const { result, client } = mountCheckout(old)
    await waitFor(() => expect(getCheckout).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(getCheckout).mock.calls[0]?.[0]?.signal

    await act(() =>
      result.current.contactMutation.mutateAsync({ email: "new@example.test" })
    )
    expect(signal?.aborted).toBe(true)
    expect(client.getQueryData(CHECKOUT_QUERY_KEY)).toEqual(saved)
    await act(async () => delayed.resolve(old))
    expect(client.getQueryData(CHECKOUT_QUERY_KEY)).toEqual(saved)
  })

  it("cancels a read started during preparation without losing its new client secret", async () => {
    const initial = checkout()
    const prepared = {
      ...initial,
      payment: { ...initial.payment, clientSecret: "fixture-secret" },
    }
    const mutation = deferred<CheckoutProjection>()
    const delayed = deferred<CheckoutProjection>()
    vi.mocked(prepareCheckoutPayment).mockReturnValue(mutation.promise)
    const { result, client } = mountCheckout(initial)
    await waitFor(() => expect(result.current.isRefreshing).toBe(false))
    let preparing: Promise<CheckoutProjection> | undefined
    act(() => {
      preparing = result.current.paymentMutation.mutateAsync(initial.revision)
    })
    await waitFor(() => expect(prepareCheckoutPayment).toHaveBeenCalledTimes(1))
    vi.mocked(getCheckout).mockReturnValueOnce(delayed.promise)
    act(() => {
      void result.current.refreshCheckout()
    })
    await waitFor(() => expect(getCheckout).toHaveBeenCalledTimes(2))
    const signal = vi.mocked(getCheckout).mock.calls[1]?.[0]?.signal
    await act(async () => {
      mutation.resolve(prepared)
      await preparing
    })
    expect(signal?.aborted).toBe(true)
    await act(async () => delayed.resolve(initial))
    expect(client.getQueryData(CHECKOUT_QUERY_KEY)).toEqual(prepared)
  })

  it("preserves a same-revision secret installed while an ordinary read is pending", async () => {
    const initial = checkout()
    const delayed = deferred<CheckoutProjection>()
    vi.mocked(getCheckout).mockReturnValueOnce(delayed.promise)
    const { client } = mountCheckout(initial)
    await waitFor(() => expect(getCheckout).toHaveBeenCalledTimes(1))
    const prepared = {
      ...initial,
      payment: { ...initial.payment, clientSecret: "fixture-secret" },
    }
    act(() => client.setQueryData(CHECKOUT_QUERY_KEY, prepared))
    await act(async () => delayed.resolve(initial))
    expect(client.getQueryData(CHECKOUT_QUERY_KEY)).toEqual(prepared)
  })

  it("applies an authoritative error projection after canceling obsolete reads", async () => {
    const old = checkout()
    const authoritative = checkout("b")
    const delayed = deferred<CheckoutProjection>()
    vi.mocked(getCheckout).mockReturnValueOnce(delayed.promise)
    const error = new CheckoutApiError({
      type: "https://remorselessrecords.com/problems/checkout-changed",
      title: "Order changed",
      detail: "Review your order.",
      status: 409,
      code: "checkout_changed",
      checkout: authoritative,
    })
    vi.mocked(prepareCheckoutPayment).mockRejectedValue(error)
    const { result, client } = mountCheckout(old)
    await waitFor(() => expect(getCheckout).toHaveBeenCalledTimes(1))
    await act(async () => {
      await expect(
        result.current.paymentMutation.mutateAsync(old.revision)
      ).rejects.toBe(error)
    })
    await act(async () => delayed.resolve(old))
    expect(client.getQueryData(CHECKOUT_QUERY_KEY)).toEqual(authoritative)
  })

  it("does not resurrect a cart after an explicit empty-cart update", async () => {
    const delayed = deferred<CheckoutProjection>()
    vi.mocked(getCheckout).mockReturnValueOnce(delayed.promise)
    const { result, client } = mountCheckout(checkout())
    await waitFor(() => expect(getCheckout).toHaveBeenCalledTimes(1))
    await act(() => result.current.setCheckout(null))
    await act(async () => delayed.resolve(checkout()))
    expect(client.getQueryData(CHECKOUT_QUERY_KEY)).toBeNull()
  })

  it("aborts active checkout reads when their observer unmounts", async () => {
    vi.mocked(getCheckout).mockReturnValue(new Promise(() => {}))
    const { unmount } = mountCheckout(checkout())
    await waitFor(() => expect(getCheckout).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(getCheckout).mock.calls[0]?.[0]?.signal
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it("isolates shipping options by revision and cancels the obsolete request", async () => {
    const initial = withAddress()
    const updated = withAddress("b")
    const delayedOptions = deferred<CheckoutShippingOption[]>()
    vi.mocked(getCheckout).mockResolvedValue(initial)
    vi.mocked(getCheckoutShippingOptions)
      .mockReturnValueOnce(delayedOptions.promise)
      .mockResolvedValue([shippingOption("current-option")])
    const { result } = mountCheckout(initial)
    await waitFor(() =>
      expect(getCheckoutShippingOptions).toHaveBeenCalledTimes(1)
    )
    const oldSignal = vi.mocked(getCheckoutShippingOptions).mock.calls[0]?.[0]
      ?.signal
    vi.mocked(getCheckout).mockResolvedValue(updated)
    await act(async () => {
      await result.current.refreshCheckout()
    })
    await waitFor(() =>
      expect(result.current.shippingOptions).toEqual([
        shippingOption("current-option"),
      ])
    )
    expect(oldSignal?.aborted).toBe(true)
    await act(async () =>
      delayedOptions.resolve([shippingOption("obsolete-option")])
    )
    expect(result.current.shippingOptions).toEqual([
      shippingOption("current-option"),
    ])
  })

  it("resumes canceled shipping reads after a write fails without a projection", async () => {
    const initial = withAddress()
    const delayedOptions = deferred<CheckoutShippingOption[]>()
    vi.mocked(getCheckout).mockResolvedValue(initial)
    vi.mocked(getCheckoutShippingOptions)
      .mockReturnValueOnce(delayedOptions.promise)
      .mockResolvedValue([shippingOption("current-option")])
    vi.mocked(saveCheckoutContact).mockRejectedValue(
      new Error("fixture failure")
    )
    const { result } = mountCheckout(initial)
    await waitFor(() =>
      expect(getCheckoutShippingOptions).toHaveBeenCalledTimes(1)
    )
    await act(async () => {
      await expect(
        result.current.contactMutation.mutateAsync({
          email: "new@example.test",
        })
      ).rejects.toThrow("fixture failure")
    })
    await waitFor(() =>
      expect(result.current.shippingOptions).toEqual([
        shippingOption("current-option"),
      ])
    )
    await act(async () =>
      delayedOptions.resolve([shippingOption("obsolete-option")])
    )
    expect(result.current.shippingOptions).toEqual([
      shippingOption("current-option"),
    ])
  })

  it("refreshes shipping options after a delivery write changes the revision", async () => {
    const initial = withAddress()
    const updated = withAddress("b")
    vi.mocked(getCheckout).mockResolvedValue(initial)
    vi.mocked(getCheckoutShippingOptions).mockResolvedValueOnce([
      shippingOption("old-address-option"),
    ])
    vi.mocked(saveCheckoutDelivery).mockResolvedValue(updated)
    const { result } = mountCheckout(initial)
    await waitFor(() =>
      expect(result.current.shippingOptions).toEqual([
        shippingOption("old-address-option"),
      ])
    )
    vi.mocked(getCheckoutShippingOptions).mockResolvedValue([
      shippingOption("new-address-option"),
    ])
    await act(() =>
      result.current.deliveryMutation.mutateAsync({
        shipping_address: {
          first_name: "Fixture",
          last_name: "Buyer",
          address_1: "124 Test Street",
          city: "Test City",
          province: "NY",
          postal_code: "10001",
          country_code: "us",
        },
      })
    )
    await waitFor(() =>
      expect(result.current.shippingOptions).toEqual([
        shippingOption("new-address-option"),
      ])
    )
    expect(saveCheckoutDelivery).toHaveBeenCalledTimes(1)
    expect(result.current.checkout?.revision).toBe(updated.revision)
  })

  it("reuses a fresh shipping read started before mutation settlement", async () => {
    const initial = withAddress()
    const prepared = {
      ...initial,
      payment: { ...initial.payment, clientSecret: "fixture-secret" },
    }
    const freshOptions = deferred<CheckoutShippingOption[]>()
    vi.mocked(getCheckout).mockResolvedValue(initial)
    vi.mocked(getCheckoutShippingOptions).mockResolvedValueOnce([
      shippingOption("cached-option"),
    ])
    vi.mocked(prepareCheckoutPayment).mockResolvedValue(prepared)
    const { result, client } = mountCheckout(initial)
    await waitFor(() =>
      expect(result.current.shippingOptions).toEqual([
        shippingOption("cached-option"),
      ])
    )
    vi.mocked(getCheckoutShippingOptions).mockReturnValue(freshOptions.promise)
    const invalidateQueries = client.invalidateQueries.bind(client)
    const settlement = vi
      .spyOn(client, "invalidateQueries")
      .mockImplementationOnce((filters, options) => {
        // Deterministically model a focus/user refresh after the authoritative
        // write is published but before its settlement invalidates shipping.
        expect(client.getQueryData(CHECKOUT_QUERY_KEY)).toEqual(prepared)
        void result.current.refreshShippingOptions()
        return invalidateQueries(filters, options)
      })

    await act(() =>
      result.current.paymentMutation.mutateAsync(initial.revision)
    )
    expect(settlement).toHaveBeenCalledTimes(1)
    expect(getCheckoutShippingOptions).toHaveBeenCalledTimes(2)
    const freshSignal = vi.mocked(getCheckoutShippingOptions).mock.calls[1]?.[0]
      ?.signal
    expect(freshSignal?.aborted).toBe(false)
    await act(async () =>
      freshOptions.resolve([shippingOption("fresh-option")])
    )
    await waitFor(() =>
      expect(result.current.shippingOptions).toEqual([
        shippingOption("fresh-option"),
      ])
    )
    expect(getCheckoutShippingOptions).toHaveBeenCalledTimes(2)
  })

  it("keeps checkout writes serialized and single-attempt", async () => {
    const contact = deferred<CheckoutProjection>()
    vi.mocked(saveCheckoutContact).mockReturnValue(contact.promise)
    vi.mocked(saveCheckoutShippingMethod).mockResolvedValue(checkout("c"))
    const { result, client } = mountCheckout(checkout())
    await waitFor(() => expect(result.current.isRefreshing).toBe(false))
    let savingContact: Promise<CheckoutProjection> | undefined
    let savingShipping: Promise<CheckoutProjection> | undefined
    act(() => {
      savingContact = result.current.contactMutation.mutateAsync({
        email: "updated@example.test",
      })
      savingShipping = result.current.shippingMutation.mutateAsync("option")
    })
    await waitFor(() => expect(saveCheckoutContact).toHaveBeenCalledTimes(1))
    expect(saveCheckoutShippingMethod).not.toHaveBeenCalled()
    await act(async () => {
      contact.resolve(checkout("b"))
      await savingContact
      await savingShipping
    })
    expect(saveCheckoutShippingMethod).toHaveBeenCalledExactlyOnceWith("option")
    expect(client.getQueryData(CHECKOUT_QUERY_KEY)).toEqual(checkout("c"))
    await waitFor(() =>
      expect(result.current.checkout?.revision).toBe(checkout("c").revision)
    )
  })

  it("cancels reads started during successful completion without replaying the write", async () => {
    const completion = deferred<CheckoutCompletion>()
    vi.mocked(completeCheckout).mockReturnValue(completion.promise)
    const delayed = deferred<CheckoutProjection>()
    const { result } = mountCheckout(checkout())
    await waitFor(() => expect(result.current.isRefreshing).toBe(false))
    let completing: Promise<CheckoutCompletion> | undefined
    act(() => {
      completing = result.current.completionMutation.mutateAsync(
        checkout().revision
      )
    })
    await waitFor(() => expect(completeCheckout).toHaveBeenCalledTimes(1))
    vi.mocked(getCheckout).mockReturnValueOnce(delayed.promise)
    act(() => {
      void result.current.refreshCheckout()
    })
    await waitFor(() => expect(getCheckout).toHaveBeenCalledTimes(2))
    const signal = vi.mocked(getCheckout).mock.calls[1]?.[0]?.signal
    const confirmation: CheckoutCompletion = {
      state: "order_confirmed",
      confirmation: { orderNumber: "fixture-order" },
    }
    await act(async () => {
      completion.resolve(confirmation)
      await expect(completing).resolves.toEqual(confirmation)
    })
    expect(signal?.aborted).toBe(true)
    await act(async () => delayed.resolve(checkout("b")))
    expect(result.current.checkout?.revision).toBe(checkout().revision)
    expect(completeCheckout).toHaveBeenCalledTimes(1)
  })
})
