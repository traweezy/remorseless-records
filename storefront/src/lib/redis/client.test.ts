import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const redisModuleMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("redis", () => ({
  createClient: redisModuleMocks.createClient,
}))

type RedisListener = (...arguments_: unknown[]) => void

const createDeferred = <T>() => {
  let rejectPromise!: (reason?: unknown) => void
  let resolvePromise!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject
    resolvePromise = resolve
  })
  return { promise, reject: rejectPromise, resolve: resolvePromise }
}

const createFakeRedisClient = ({
  connect,
  isOpen = false,
  isReady = false,
}: {
  connect?: () => Promise<void>
  isOpen?: boolean
  isReady?: boolean
} = {}) => {
  const listeners = new Map<string, RedisListener[]>()
  const connectMock = vi.fn<() => Promise<void>>()
  const client = {
    connect: connectMock,
    isOpen,
    isReady,
    listenerCount: vi.fn((event: string) => listeners.get(event)?.length ?? 0),
    on: vi.fn((event: string, listener: RedisListener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return client
    }),
  }
  connectMock.mockImplementation(
    connect ??
      (() => {
        client.isOpen = true
        client.isReady = true
        return Promise.resolve()
      })
  )
  return { client, listeners }
}

const loadRedisClient = () => import("./client")

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv("NODE_ENV", "test")
  vi.stubEnv("REDIS_URL", "redis://localhost:6379")
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("shared Redis client", () => {
  it("allows an omitted Redis service only outside production", async () => {
    vi.stubEnv("REDIS_URL", " ")
    const developmentModule = await loadRedisClient()

    await expect(developmentModule.getSharedRedisClient()).resolves.toBeNull()
    expect(redisModuleMocks.createClient).not.toHaveBeenCalled()

    vi.resetModules()
    vi.stubEnv("NODE_ENV", "production")
    const productionModule = await loadRedisClient()

    await expect(productionModule.getSharedRedisClient()).rejects.toMatchObject(
      {
        message: "Shared Redis service unavailable",
        name: "RedisUnavailableError",
      }
    )
  })

  it("creates one bounded client and shares an in-flight connection", async () => {
    const connection = createDeferred<void>()
    const { client } = createFakeRedisClient({
      connect: () => connection.promise,
    })
    redisModuleMocks.createClient.mockReturnValue(client)
    const { getSharedRedisClient } = await loadRedisClient()

    const first = getSharedRedisClient()
    const second = getSharedRedisClient()

    expect(redisModuleMocks.createClient).toHaveBeenCalledOnce()
    expect(redisModuleMocks.createClient).toHaveBeenCalledWith({
      commandsQueueMaxLength: 1_000,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 2_000,
        keepAlive: true,
      },
      url: "redis://localhost:6379",
    })
    expect(client.connect).toHaveBeenCalledOnce()
    expect(client.on).toHaveBeenCalledTimes(5)

    connection.resolve()
    await expect(Promise.all([first, second])).resolves.toEqual([
      client,
      client,
    ])
  })

  it("returns a ready client and registers only missing event listeners", async () => {
    const { client, listeners } = createFakeRedisClient({
      isOpen: true,
      isReady: true,
    })
    const existingReadyListener = vi.fn()
    listeners.set("ready", [existingReadyListener])
    redisModuleMocks.createClient.mockReturnValue(client)
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { getSharedRedisClient } = await loadRedisClient()

    await expect(getSharedRedisClient()).resolves.toBe(client)
    expect(client.connect).not.toHaveBeenCalled()
    expect(client.on).toHaveBeenCalledTimes(4)
    expect(client.on).not.toHaveBeenCalledWith("ready", expect.any(Function))

    for (const event of ["connect", "reconnecting", "end", "error"]) {
      listeners.get(event)?.[0]?.()
    }

    const loggedEvents = [
      ...info.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]
      .map(([payload]) => JSON.parse(String(payload)) as { event?: string })
      .map(({ event }) => event)
    expect(loggedEvents).toEqual([
      "redis.connection.connecting",
      "redis.connection.reconnecting",
      "redis.connection.closed",
      "redis.connection.error",
    ])
    expect(JSON.stringify(loggedEvents)).not.toContain("localhost")
  })

  it("normalizes connection failures and permits a later retry", async () => {
    const { client } = createFakeRedisClient({
      connect: () => Promise.reject(new Error("redis://user:secret@host")),
    })
    redisModuleMocks.createClient.mockReturnValue(client)
    const { getSharedRedisClient } = await loadRedisClient()

    await expect(getSharedRedisClient()).rejects.toMatchObject({
      message: "Shared Redis service unavailable",
      name: "RedisUnavailableError",
    })
    await expect(getSharedRedisClient()).rejects.not.toThrow("secret")
    expect(client.connect).toHaveBeenCalledTimes(2)
  })

  it("waits for an open client to become ready", async () => {
    vi.useFakeTimers()
    const { client } = createFakeRedisClient({ isOpen: true })
    redisModuleMocks.createClient.mockReturnValue(client)
    const { getSharedRedisClient } = await loadRedisClient()

    const pendingClient = getSharedRedisClient()
    client.isReady = true
    await vi.advanceTimersByTimeAsync(50)

    await expect(pendingClient).resolves.toBe(client)
    expect(client.connect).not.toHaveBeenCalled()
  })

  it("fails closed when an open client never becomes ready", async () => {
    vi.useFakeTimers()
    const { client } = createFakeRedisClient({ isOpen: true })
    redisModuleMocks.createClient.mockReturnValue(client)
    const { getSharedRedisClient } = await loadRedisClient()

    const assertion = expect(getSharedRedisClient()).rejects.toMatchObject({
      message: "Shared Redis service unavailable",
      name: "RedisUnavailableError",
    })
    await vi.advanceTimersByTimeAsync(2_050)

    await assertion
  })
})

describe("Redis command timeout", () => {
  it("preserves success while redacting rejection details", async () => {
    const { withRedisTimeout } = await loadRedisClient()

    await expect(withRedisTimeout(Promise.resolve("PONG"))).resolves.toBe(
      "PONG"
    )
    await expect(
      withRedisTimeout(Promise.reject(new Error("private provider detail")))
    ).rejects.toMatchObject({
      message: "Shared Redis service unavailable",
      name: "RedisUnavailableError",
    })
  })

  it("rejects an operation that exceeds the command deadline", async () => {
    vi.useFakeTimers()
    const { withRedisTimeout } = await loadRedisClient()
    const neverSettles = new Promise<never>(() => undefined)

    const assertion = expect(
      withRedisTimeout(neverSettles)
    ).rejects.toMatchObject({
      message: "Shared Redis service unavailable",
      name: "RedisUnavailableError",
    })
    await vi.advanceTimersByTimeAsync(2_000)

    await assertion
  })
})
