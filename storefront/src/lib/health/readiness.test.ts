import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

vi.mock("@/lib/redis/client", () => ({
  getSharedRedisClient: vi.fn(),
  withRedisTimeout: vi.fn(),
}))

import {
  getSharedRedisClient,
  type SharedRedisClient,
  withRedisTimeout,
} from "@/lib/redis/client"

import {
  createStorefrontReadinessProbes,
  runReadinessChecks,
  type ReadinessProbe,
} from "./readiness"

const fetchMock = vi.fn<typeof fetch>()

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("runReadinessChecks", () => {
  it("reports all healthy dependencies", async () => {
    const probes: ReadinessProbe[] = [
      { check: () => Promise.resolve(), name: "backend" },
      { check: () => Promise.resolve(), name: "redis" },
    ]

    const checks = await runReadinessChecks(probes)

    expect(checks).toHaveLength(2)
    expect(checks[0]).toMatchObject({ name: "backend", status: "ok" })
    expect(checks[1]).toMatchObject({ name: "redis", status: "ok" })
    expect(checks.every((check) => Number.isFinite(check.duration_ms))).toBe(
      true
    )
  })

  it("redacts failing dependency details", async () => {
    const secret = "redis://user:secret@example.test"
    const checks = await runReadinessChecks([
      {
        check: () => Promise.reject(new Error(secret)),
        name: "redis",
      },
    ])

    expect(checks[0]?.status).toBe("error")
    expect(JSON.stringify(checks)).not.toContain(secret)
  })
})

describe("createStorefrontReadinessProbes", () => {
  it("checks the private backend URL before the public fallback", async () => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    vi.mocked(getSharedRedisClient).mockResolvedValue(null)

    const [backend] = createStorefrontReadinessProbes({
      MEDUSA_BACKEND_URL: " https://private-backend.example ",
      NEXT_PUBLIC_MEDUSA_URL: "https://public-backend.example",
      NODE_ENV: "test",
    })

    await expect(backend?.check()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://private-backend.example/ready"),
      expect.objectContaining({ cache: "no-store" })
    )
  })

  it("uses the public backend URL when the private URL is blank", async () => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    vi.mocked(getSharedRedisClient).mockResolvedValue(null)

    const [backend] = createStorefrontReadinessProbes({
      MEDUSA_BACKEND_URL: " ",
      NEXT_PUBLIC_MEDUSA_URL: "https://public-backend.example",
      NODE_ENV: "test",
    })

    await expect(backend?.check()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://public-backend.example/ready"),
      expect.objectContaining({ cache: "no-store" })
    )
  })

  it("fails when the backend URL is missing or unhealthy", async () => {
    const [missingBackend] = createStorefrontReadinessProbes({
      NODE_ENV: "test",
    })
    await expect(missingBackend?.check()).rejects.toThrow(
      "Backend URL is not configured."
    )

    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }))
    const [unhealthyBackend] = createStorefrontReadinessProbes({
      MEDUSA_BACKEND_URL: "https://private-backend.example",
      NODE_ENV: "test",
    })
    await expect(unhealthyBackend?.check()).rejects.toThrow(
      "Backend is not ready."
    )
  })

  it("allows a missing Redis client outside production", async () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.mocked(getSharedRedisClient).mockResolvedValue(null)
    const [, redis] = createStorefrontReadinessProbes({ NODE_ENV: "test" })

    await expect(redis?.check()).resolves.toBeUndefined()
  })

  it("requires Redis in production and pings a configured client", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.mocked(getSharedRedisClient).mockResolvedValueOnce(null)
    const [, missingRedis] = createStorefrontReadinessProbes({
      NODE_ENV: "production",
    })
    await expect(missingRedis?.check()).rejects.toThrow(
      "Redis is not configured."
    )

    const ping = vi.fn<() => Promise<string>>().mockResolvedValue("PONG")
    vi.mocked(getSharedRedisClient).mockResolvedValueOnce({
      ping,
    } as unknown as SharedRedisClient)
    vi.mocked(withRedisTimeout).mockResolvedValue("PONG")
    const [, configuredRedis] = createStorefrontReadinessProbes({
      NODE_ENV: "production",
    })

    await expect(configuredRedis?.check()).resolves.toBeUndefined()
    expect(ping).toHaveBeenCalledOnce()
    expect(withRedisTimeout).toHaveBeenCalledOnce()
  })
})
