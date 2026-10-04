// Stripe.js loads its own chunks through native script.src assignments. The
// named policy in the pinned npm loader only covers its initial script.
// Keep this default policy limited to Stripe HTTPS scripts and this one sink;
// it must never convert HTML, executable text, workers, or arbitrary URLs.
export const requireStripeDynamicScriptURL = (
  candidate: string,
  type: string,
  sink: string
): string => {
  if (
    type !== "TrustedScriptURL" ||
    sink !== "HTMLScriptElement src" ||
    candidate.length > 2048 ||
    !/^https:\/\/(?:[a-z0-9-]+\.)?js\.stripe\.com\/[A-Za-z0-9_./-]+\.js$/.test(
      candidate
    )
  ) {
    throw new TypeError("Stripe dynamic script URL is not trusted")
  }
  // Reject normalization tricks, traversal, credentials, and non-default ports.
  if (new URL(candidate).href !== candidate) {
    throw new TypeError("Stripe dynamic script URL is not trusted")
  }
  return candidate
}

type StripePolicyFactory = {
  defaultPolicy?: unknown
  createPolicy: (
    name: string,
    rules: { createScriptURL: typeof requireStripeDynamicScriptURL }
  ) => unknown
}

const installedFactories = new WeakSet<StripePolicyFactory>()

export const installStripeDynamicScriptPolicy = (): void => {
  if (typeof window === "undefined") return
  const factory: unknown = Reflect.get(window, "trustedTypes")
  if (factory === undefined) return
  if (
    typeof factory !== "object" ||
    factory === null ||
    !("createPolicy" in factory) ||
    typeof factory.createPolicy !== "function"
  ) {
    throw new TypeError("Stripe Trusted Types factory is unavailable")
  }
  const verifiedFactory = factory as StripePolicyFactory
  if (installedFactories.has(verifiedFactory)) return
  if (verifiedFactory.defaultPolicy != null) {
    throw new TypeError("An unexpected default Trusted Types policy exists")
  }
  verifiedFactory.createPolicy("default", {
    createScriptURL: requireStripeDynamicScriptURL,
  })
  installedFactories.add(verifiedFactory)
}
