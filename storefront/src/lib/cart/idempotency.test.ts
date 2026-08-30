import type { HttpTypes } from "@medusajs/types"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { runIdempotentCartMutation } from "@/lib/cart/idempotency"
import { CART_COOKIE_NAME, signCartId } from "@/lib/cart/cookie"

const cartFixture = (id = "cart_01IDEMPOTENT"): HttpTypes.StoreCart =>
  ({
    id,
    currency_code: "usd",
    items: [],
  }) as unknown as HttpTypes.StoreCart

const TEST_CART_COOKIE_SECRET = "test-cart-cookie-secret-at-least-32-chars"

const createRequest = (
  idempotencyKey?: string,
  cartId?: string,
  rawCookie?: string
): NextRequest =>
  new NextRequest("https://storefront.test/api/cart/items", {
    method: "POST",
    headers: {
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...(rawCookie
        ? { cookie: `${CART_COOKIE_NAME}=${rawCookie}` }
        : cartId
          ? {
              cookie: `${CART_COOKIE_NAME}=${signCartId(
                cartId,
                TEST_CART_COOKIE_SECRET
              )}`,
            }
          : {}),
    },
  })

const deferred = <T>() => {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

describe("cart mutation idempotency", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv("REDIS_URL", "")
    vi.stubEnv("CART_COOKIE_SECRET", TEST_CART_COOKIE_SECRET)
  })

  it("replays a completed mutation without executing it twice", async () => {
    const key = crypto.randomUUID()
    const cart = cartFixture()
    const execute = vi.fn().mockResolvedValue(cart)
    const replay = vi.fn().mockResolvedValue(cart)
    const options = {
      operation: "cart.item.add",
      payload: { variantId: "variant_01ABC", quantity: 1 },
      execute,
      replay,
    }

    const first = await runIdempotentCartMutation({
      ...options,
      request: createRequest(key),
    })
    const second = await runIdempotentCartMutation({
      ...options,
      request: createRequest(key),
    })

    expect(first).toMatchObject({ ok: true, replayed: false })
    expect(second).toMatchObject({ ok: true, replayed: true })
    expect(execute).toHaveBeenCalledOnce()
    expect(replay).toHaveBeenCalledWith(cart.id)
  })

  it("serializes concurrent requests carrying the same key", async () => {
    const key = crypto.randomUUID()
    const pending = deferred<HttpTypes.StoreCart>()
    const cart = cartFixture("cart_01CONCURRENT")
    const execute = vi.fn().mockReturnValue(pending.promise)
    const replay = vi.fn().mockResolvedValue(cart)
    const options = {
      operation: "cart.item.add",
      payload: { variantId: "variant_01ABC", quantity: 1 },
      execute,
      replay,
    }

    const first = runIdempotentCartMutation({
      ...options,
      request: createRequest(key),
    })
    const second = runIdempotentCartMutation({
      ...options,
      request: createRequest(key),
    })

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledOnce()
    })
    pending.resolve(cart)

    await expect(first).resolves.toMatchObject({
      ok: true,
      replayed: false,
    })
    await expect(second).resolves.toMatchObject({
      ok: true,
      replayed: true,
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it("rejects reuse of a completed key with different mutation details", async () => {
    const key = crypto.randomUUID()
    const cart = cartFixture("cart_01CONFLICT")
    const execute = vi.fn().mockResolvedValue(cart)
    const replay = vi.fn().mockResolvedValue(cart)

    await runIdempotentCartMutation({
      request: createRequest(key),
      operation: "cart.item.add",
      payload: { variantId: "variant_01ABC", quantity: 1 },
      execute,
      replay,
    })
    const conflict = await runIdempotentCartMutation({
      request: createRequest(key),
      operation: "cart.item.add",
      payload: { variantId: "variant_01ABC", quantity: 2 },
      execute,
      replay,
    })

    expect(conflict.ok).toBe(false)
    if (!conflict.ok) {
      expect(conflict.response.status).toBe(409)
      await expect(conflict.response.json()).resolves.toMatchObject({
        code: "idempotency_key_reused",
      })
    }
    expect(execute).toHaveBeenCalledOnce()
  })

  it("scopes the same request key to the signed cart identity", async () => {
    const key = crypto.randomUUID()
    const firstCart = cartFixture("cart_01FIRST")
    const secondCart = cartFixture("cart_01SECOND")
    const execute = vi
      .fn()
      .mockResolvedValueOnce(firstCart)
      .mockResolvedValueOnce(secondCart)
    const options = {
      operation: "cart.item.update",
      payload: { itemId: "cali_01ITEM", quantity: 2 },
      execute,
      replay: vi.fn(),
    }

    const first = await runIdempotentCartMutation({
      ...options,
      request: createRequest(key, firstCart.id),
    })
    const second = await runIdempotentCartMutation({
      ...options,
      request: createRequest(key, secondCart.id),
    })

    expect(first).toMatchObject({ ok: true, replayed: false })
    expect(second).toMatchObject({ ok: true, replayed: false })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it("does not let invalid cookie values create idempotency scopes", async () => {
    const key = crypto.randomUUID()
    const cart = cartFixture("cart_01INVALIDCOOKIE")
    const execute = vi.fn().mockResolvedValue(cart)
    const replay = vi.fn().mockResolvedValue(cart)
    const options = {
      operation: "cart.item.add",
      payload: { variantId: "variant_01ABC", quantity: 1 },
      execute,
      replay,
    }

    const first = await runIdempotentCartMutation({
      ...options,
      request: createRequest(key, undefined, "attacker-controlled-value"),
    })
    const second = await runIdempotentCartMutation({
      ...options,
      request: createRequest(key, undefined, "different-invalid-value"),
    })

    expect(first).toMatchObject({ ok: true, replayed: false })
    expect(second).toMatchObject({ ok: true, replayed: true })
    expect(execute).toHaveBeenCalledOnce()
    expect(replay).toHaveBeenCalledWith(cart.id)
  })

  it("requires a valid idempotency key before executing", async () => {
    const execute = vi.fn().mockResolvedValue(cartFixture())
    const result = await runIdempotentCartMutation({
      request: createRequest(),
      operation: "cart.item.add",
      payload: { variantId: "variant_01ABC", quantity: 1 },
      execute,
      replay: vi.fn(),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
    }
    expect(execute).not.toHaveBeenCalled()
  })
})
