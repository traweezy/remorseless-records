import type { BundleComposition } from "@/types/bundle"

type BundleResponse = {
  bundle: BundleComposition | null
}

export const getCartBundleComposition = async (
  handle: string,
  signal?: AbortSignal
): Promise<BundleComposition | null> => {
  const timeout = AbortSignal.timeout(8_000)
  const response = await fetch(
    `/api/products/${encodeURIComponent(handle)}/bundle`,
    {
      cache: "no-store",
      credentials: "same-origin",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }
  )

  if (!response.ok) {
    throw new Error("Unable to load bundle contents.")
  }

  return ((await response.json()) as BundleResponse).bundle
}
