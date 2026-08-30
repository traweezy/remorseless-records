import { FetchError, type FetchArgs } from "@medusajs/js-sdk"
import { z } from "zod"

import {
  AdminRequestError,
  type AdminSdkClient,
  requestAdminJson,
} from "./admin-request"

const responseSchema = z.object({
  value: z.string(),
})

const createClient = (
  implementation: (
    input: Parameters<AdminSdkClient["fetch"]>[0],
    init?: FetchArgs
  ) => Promise<unknown>
): AdminSdkClient => ({
  fetch: jest.fn(implementation) as AdminSdkClient["fetch"],
})

describe("requestAdminJson", () => {
  it("passes structured request data to the SDK and validates the response", async () => {
    const client = createClient(async () => ({ value: "ok" }))

    await expect(
      requestAdminJson({
        body: { enabled: true },
        client,
        method: "POST",
        path: "/admin/example",
        query: { limit: 25 },
        schema: responseSchema,
      })
    ).resolves.toEqual({ value: "ok" })

    expect(client.fetch).toHaveBeenCalledWith(
      "/admin/example",
      expect.objectContaining({
        body: { enabled: true },
        method: "POST",
        query: { limit: 25 },
        signal: expect.any(AbortSignal),
      })
    )
  })

  it("fails closed when the response contract is invalid", async () => {
    const client = createClient(async () => ({ value: 42 }))

    await expect(
      requestAdminJson({
        client,
        path: "/admin/example",
        schema: responseSchema,
      })
    ).rejects.toMatchObject({
      kind: "invalid-response",
      message: "The server returned an unexpected response.",
    })
  })

  it("preserves the safe SDK HTTP message and status", async () => {
    const client = createClient(async () => {
      throw new FetchError("The asset changed.", "Conflict", 409)
    })

    await expect(
      requestAdminJson({
        client,
        path: "/admin/example",
        schema: responseSchema,
      })
    ).rejects.toMatchObject({
      kind: "http",
      message: "The asset changed.",
      status: 409,
    })
  })

  it("aborts a request that exceeds its timeout", async () => {
    const client = createClient(
      async (_input, init) =>
        await new Promise((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Aborted", "AbortError"))
            },
            { once: true }
          )
        })
    )

    await expect(
      requestAdminJson({
        client,
        path: "/admin/example",
        schema: responseSchema,
        timeoutMs: 1,
      })
    ).rejects.toMatchObject({
      kind: "timeout",
      message: "The request took too long. Try again.",
    })
  })

  it("distinguishes caller cancellation from a timeout", async () => {
    const controller = new AbortController()
    controller.abort()
    const client = createClient(async () => {
      throw new DOMException("Aborted", "AbortError")
    })

    await expect(
      requestAdminJson({
        client,
        path: "/admin/example",
        schema: responseSchema,
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(AdminRequestError)
    await expect(
      requestAdminJson({
        client,
        path: "/admin/example",
        schema: responseSchema,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({
      kind: "cancelled",
      message: "The request was cancelled.",
    })
  })

  it("rejects invalid internal timeout configuration", async () => {
    const client = createClient(async () => ({ value: "ok" }))

    await expect(
      requestAdminJson({
        client,
        path: "/admin/example",
        schema: responseSchema,
        timeoutMs: 0,
      })
    ).rejects.toThrow(
      new RangeError("Admin request timeout must be a positive integer")
    )
  })
})
