export type JsonLdData =
  | Record<string, unknown>
  | Array<Record<string, unknown>>

export const JSON_LD_TRUSTED_TYPES_POLICY = "remorseless-json-ld"
export const MAX_JSON_LD_BYTES = 1_048_576

type JsonLdPolicy = {
  createScript: (candidate: string) => unknown
}

type JsonLdPolicyFactory = {
  createPolicy: (
    name: string,
    rules: { createScript: (candidate: string) => string }
  ) => unknown
  isScript: (value: unknown) => boolean
}

const policies = new WeakMap<JsonLdPolicyFactory, JsonLdPolicy>()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isPolicyFactory = (value: unknown): value is JsonLdPolicyFactory =>
  isRecord(value) &&
  typeof value.createPolicy === "function" &&
  typeof value.isScript === "function"

const isPolicy = (value: unknown): value is JsonLdPolicy =>
  isRecord(value) && typeof value.createScript === "function"

export const serializeJsonLd = (data: JsonLdData): string =>
  JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")

// The policy accepts only our serializer's exact JSON object/record-array
// representation. Never turn arbitrary executable source into TrustedScript.
export const requireCanonicalJsonLd = (candidate: string): string => {
  try {
    if (
      candidate.length > MAX_JSON_LD_BYTES ||
      new TextEncoder().encode(candidate).byteLength > MAX_JSON_LD_BYTES
    ) {
      throw new TypeError()
    }
    const parsed: unknown = JSON.parse(candidate)
    if (
      !isRecord(parsed) &&
      !(Array.isArray(parsed) && parsed.every(isRecord))
    ) {
      throw new TypeError()
    }
    if (serializeJsonLd(parsed) !== candidate) throw new TypeError()
    return candidate
  } catch {
    throw new TypeError("JSON-LD must be canonical serialized object data.")
  }
}

export const createJsonLdScript = (
  targetDocument: Document,
  serialized: string
): HTMLScriptElement => {
  requireCanonicalJsonLd(serialized)
  const factory: unknown = Reflect.get(
    targetDocument.defaultView ?? globalThis,
    "trustedTypes"
  )
  let value: unknown = serialized
  if (factory !== undefined) {
    if (!isPolicyFactory(factory)) {
      throw new TypeError("JSON-LD Trusted Types factory is unavailable.")
    }
    let policy = policies.get(factory)
    if (!policy) {
      const created = factory.createPolicy(JSON_LD_TRUSTED_TYPES_POLICY, {
        createScript: requireCanonicalJsonLd,
      })
      if (!isPolicy(created)) {
        throw new TypeError("JSON-LD Trusted Types policy is unavailable.")
      }
      policy = created
      policies.set(factory, policy)
    }
    value = policy.createScript(serialized)
    if (!factory.isScript(value)) {
      throw new TypeError("JSON-LD Trusted Types policy returned invalid data.")
    }
  }
  const script = targetDocument.createElement("script")
  script.type = "application/ld+json"
  // lib.dom lacks TrustedScript types. Reflect preserves the native value at
  // this one fixed data sink; no string cast, HTML parser, or URL capability.
  if (!Reflect.set(script, "text", value)) {
    throw new TypeError("JSON-LD text assignment failed.")
  }
  return script
}
