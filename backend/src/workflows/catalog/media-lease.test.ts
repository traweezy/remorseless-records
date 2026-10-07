import path from "node:path"
import { Modules } from "@medusajs/framework/utils"
import {
  CATALOG_MEDIA_RELEASE_DEADLINE_MS,
  releaseCommittedCatalogMediaLease,
} from "./media-lease"

const fixture = () => {
  const release = jest.fn<Promise<boolean>, unknown[]>().mockResolvedValue(true)
  const warn = jest.fn()
  const container = {
    resolve: (key: string) =>
      key === Modules.LOCKING ? { release } : { warn },
  }
  const lease = {
    keys: ["catalog:product-media:prod_owned"],
    ownerId: "owned-lease-token",
  }
  return { release, warn, container, lease }
}

describe("committed catalog media lease cleanup", () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it("releases only the persisted owner token after committed success", async () => {
    const f = fixture()
    await releaseCommittedCatalogMediaLease(f.container as never, f.lease)
    expect(f.release).toHaveBeenCalledWith(f.lease.keys, {
      ownerId: f.lease.ownerId,
    })
    expect(f.warn).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "warns on cleanup failure and does not throw when loggerFails=%s",
    async (loggerFails) => {
      const f = fixture()
      f.release.mockRejectedValue(new Error("Isolated Redis failure"))
      if (loggerFails)
        f.warn.mockImplementation(() => {
          throw new Error("Isolated logger failure")
        })
      await expect(
        releaseCommittedCatalogMediaLease(f.container as never, f.lease)
      ).resolves.toBeUndefined()
      expect(f.warn).toHaveBeenCalledWith(
        expect.stringContaining("120-second lease")
      )
    }
  )

  it("bounds stalled cleanup and preserves the installed Redis owner's comparison on late release", async () => {
    jest.useFakeTimers()
    const medusa = path.dirname(require.resolve("@medusajs/medusa"))
    const providerPath = require.resolve("@medusajs/locking-redis", {
      paths: [medusa],
    })
    const { RedisLockingProvider } = jest.requireActual<{
      RedisLockingProvider: new (
        container: object,
        options: object
      ) => {
        release: (keys: string[], args: { ownerId: string }) => Promise<boolean>
      }
    }>(path.join(path.dirname(providerPath), "services/redis-lock.js"))
    let finish: () => void = () => undefined
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const owners = new Map([
      ["medusa_lock:catalog:product-media:prod_owned", "owned-lease-token"],
    ])
    const commands = new Map<string, string>()
    const native = new RedisLockingProvider(
      {
        redisClient: {
          defineCommand: (name: string, { lua }: { lua: string }) => {
            commands.set(name, lua)
          },
          releaseLock: async (key: string, owner: string) => {
            await pending
            if (owners.get(key) !== owner) return 0
            owners.delete(key)
            return 1
          },
        },
      },
      {}
    )
    const warn = jest.fn()
    const container = {
      resolve: (key: string) => (key === Modules.LOCKING ? native : { warn }),
    }
    const lease = {
      keys: ["catalog:product-media:prod_owned"],
      ownerId: "owned-lease-token",
    }
    const cleanup = releaseCommittedCatalogMediaLease(container as never, lease)
    await jest.advanceTimersByTimeAsync(CATALOG_MEDIA_RELEASE_DEADLINE_MS)
    await expect(cleanup).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(commands.get("releaseLock")).toContain(
      "redis.call('GET', key) == ownerId"
    )
    // Model expiry and another acquisition while the old network call is late.
    owners.set("medusa_lock:catalog:product-media:prod_owned", "next-owner")
    finish()
    await jest.advanceTimersByTimeAsync(0)
    expect(owners.get("medusa_lock:catalog:product-media:prod_owned")).toBe(
      "next-owner"
    )
    expect(jest.getTimerCount()).toBe(0)
  })
})
