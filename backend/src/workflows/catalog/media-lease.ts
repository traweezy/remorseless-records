import type {
  ILockingModule,
  Logger,
  MedusaContainer,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export const CATALOG_MEDIA_LEASE_SECONDS = 120
export const CATALOG_MEDIA_RELEASE_DEADLINE_MS = 2_000
export type CatalogMediaLease = { keys: string[]; ownerId: string }

/** A committed audit operation must not roll back because lock cleanup failed. */
export const releaseCommittedCatalogMediaLease = async (
  container: MedusaContainer,
  lease: CatalogMediaLease
): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let released = false
  try {
    const locking = container.resolve<ILockingModule>(Modules.LOCKING)
    // The installed Redis provider compares this unique owner token before DEL.
    // A late completion after the deadline/expiry cannot unlock another writer.
    released = await Promise.race([
      locking
        .release(lease.keys, { ownerId: lease.ownerId })
        .catch(() => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(
          () => resolve(false),
          CATALOG_MEDIA_RELEASE_DEADLINE_MS
        )
      }),
    ])
  } catch {
    // Resolution and transport errors use the same bounded TTL fallback.
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (!released) {
    try {
      container
        .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
        .warn(
          "Catalog artwork committed, but lease cleanup failed or timed out; its 120-second lease will expire."
        )
    } catch {
      // Logging cannot turn a committed operation into stale compensation.
    }
  }
}
