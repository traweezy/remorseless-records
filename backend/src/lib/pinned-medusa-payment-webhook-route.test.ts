import { readFileSync } from "node:fs"
import path from "node:path"

import { Modules, PaymentWebhookEvents } from "@medusajs/framework/utils"

type NativePaymentWebhookPost = (
  req: {
    body: Record<string, unknown>
    headers: Record<string, string>
    params: { provider: string }
    rawBody: Buffer
    scope: { resolve: (key: string) => unknown }
  },
  res: {
    send: jest.Mock
    sendStatus: jest.Mock
    status: jest.Mock
  }
) => Promise<void>

const medusaDirectory = path.dirname(require.resolve("@medusajs/medusa"))
const routePath = path.join(
  medusaDirectory,
  "api/hooks/payment/[provider]/route.js"
)
const post = jest.requireActual<{ POST: NativePaymentWebhookPost }>(
  routePath
).POST
const publicFailure = "Webhook Error: Unable to enqueue payment webhook."

const createFixture = (options?: unknown) => {
  const emit = jest.fn().mockResolvedValue(undefined)
  const resolve = jest.fn((key: string): unknown => {
    if (key === Modules.PAYMENT) return { options }
    if (key === Modules.EVENT_BUS) return { emit }
    throw new Error("Unexpected fixture dependency")
  })
  const request = {
    body: { fixture: true },
    headers: { "stripe-signature": "invalid-fixture-signature" },
    params: { provider: "stripe_stripe" },
    rawBody: Buffer.from('{"fixture":true}'),
    scope: { resolve },
  }
  const response = {
    send: jest.fn(),
    sendStatus: jest.fn(),
    status: jest.fn(),
  }
  response.status.mockReturnValue(response)
  return { emit, request, resolve, response }
}

const expectFixedFailure = (
  response: ReturnType<typeof createFixture>["response"]
): void => {
  expect(response.status.mock.calls).toEqual([[400]])
  expect(response.send.mock.calls).toEqual([[publicFailure]])
  expect(response.sendStatus).not.toHaveBeenCalled()
}

describe("pinned Medusa payment webhook route", () => {
  it("retains the installed 2.18 route and raw-body middleware boundary", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(medusaDirectory, "../package.json"), "utf8")
    ) as { version?: unknown }
    const { hooksRoutesMiddlewares } = jest.requireActual<{
      hooksRoutesMiddlewares: unknown
    }>(path.join(medusaDirectory, "api/hooks/middlewares.js"))

    expect(packageJson.version).toBe("2.18.0")
    expect(hooksRoutesMiddlewares).toEqual([
      {
        bodyParser: { preserveRawBody: true },
        matcher: "/hooks/payment/:provider",
        method: ["POST"],
      },
    ])
  })

  it("acknowledges enqueueing without claiming synchronous signature verification", async () => {
    const { emit, request, resolve, response } = createFixture()

    await post(request, response)

    expect(resolve.mock.calls).toEqual([[Modules.PAYMENT], [Modules.EVENT_BUS]])
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(
      {
        data: {
          payload: {
            data: request.body,
            headers: request.headers,
            rawData: request.rawBody,
          },
          provider: "stripe_stripe",
        },
        name: PaymentWebhookEvents.WebhookReceived,
      },
      { attempts: 3, delay: 5_000 }
    )
    expect(response.sendStatus.mock.calls).toEqual([[200]])
    expect(response.status).not.toHaveBeenCalled()
    expect(response.send).not.toHaveBeenCalled()
  })

  it("preserves configured enqueue delay and retry count", async () => {
    const { emit, request, response } = createFixture({
      webhook_delay: 1_500,
      webhook_retries: 5,
    })

    await post(request, response)

    expect(emit).toHaveBeenCalledWith(expect.anything(), {
      attempts: 5,
      delay: 1_500,
    })
    expect(response.sendStatus.mock.calls).toEqual([[200]])
  })

  it.each([
    ["missing", undefined],
    ["null", null],
    ["zero-valued", { webhook_delay: 0, webhook_retries: 0 }],
  ])(
    "preserves default enqueue options for %s configuration",
    async (_, options) => {
      const { emit, request, response } = createFixture(options)

      await post(request, response)

      expect(emit).toHaveBeenCalledWith(expect.anything(), {
        attempts: 3,
        delay: 5_000,
      })
      expect(response.sendStatus.mock.calls).toEqual([[200]])
    }
  )

  it("does not acknowledge the request before enqueueing settles", async () => {
    const { emit, request, response } = createFixture()
    let finishEnqueue!: () => void
    emit.mockReturnValue(
      new Promise<void>((resolve) => {
        finishEnqueue = resolve
      })
    )

    const pending = post(request, response)
    expect(response.sendStatus).not.toHaveBeenCalled()
    finishEnqueue()
    await pending

    expect(response.sendStatus.mock.calls).toEqual([[200]])
  })

  it.each([
    ["Error", new Error("synthetic-private-transport-marker")],
    ["string", "synthetic-private-transport-marker"],
    ["object", { message: "synthetic-private-transport-marker" }],
    ["null", null],
    ["undefined", undefined],
  ])(
    "returns a fixed 400 for a rejected enqueue with %s",
    async (_, failure) => {
      const { emit, request, response } = createFixture()
      emit.mockRejectedValue(failure)

      await post(request, response)

      expectFixedFailure(response)
    }
  )

  it("never reads a thrown object's message getter", async () => {
    const { emit, request, response } = createFixture()
    const message = jest.fn(() => {
      throw new Error("Synthetic error getter must not run")
    })
    const failure = Object.defineProperty({}, "message", { get: message })
    emit.mockRejectedValue(failure)

    await post(request, response)

    expectFixedFailure(response)
    expect(message).not.toHaveBeenCalled()
  })

  it("redacts a synchronous enqueue failure", async () => {
    const { emit, request, response } = createFixture()
    emit.mockImplementation(() => {
      throw new Error("synthetic-private-transport-marker")
    })

    await post(request, response)

    expectFixedFailure(response)
  })

  it.each([Modules.PAYMENT, Modules.EVENT_BUS])(
    "redacts a %s dependency resolution failure",
    async (dependency) => {
      const { emit, request, resolve, response } = createFixture()
      const originalResolve = resolve.getMockImplementation()
      resolve.mockImplementation((key) => {
        if (key === dependency) {
          throw new Error("synthetic-private-container-marker")
        }
        return originalResolve?.(key)
      })

      await post(request, response)

      expectFixedFailure(response)
      expect(emit).not.toHaveBeenCalled()
    }
  )
})
