import { createHash } from "node:crypto"

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (!value || typeof value !== "object") {
    return value
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  )
}

export const hashCatalogCommand = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")

export const deriveCatalogCommandIdempotencyKey = (
  parentIdempotencyKey: string,
  scope: string,
): string => {
  const digest = createHash("sha256")
    .update(`${parentIdempotencyKey}:${scope}`)
    .digest()
  const bytes = Uint8Array.from(digest.subarray(0, 16))

  // Preserve RFC 4122 version/variant bits so the deterministic child key can
  // pass the same UUID boundary validation as the client-supplied parent key.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex = Buffer.from(bytes).toString("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-")
}
