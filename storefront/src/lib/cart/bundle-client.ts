import {
  bundleCompositionResponseSchema,
  type BundleComposition,
} from "@/types/bundle"

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

  const payload: unknown = await response.json()
  const parsed = bundleCompositionResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error("Unable to load bundle contents.")
  }
  return parsed.data.bundle
}
