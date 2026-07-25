export type MonetaryMigrationArguments =
  | {
      apply: false
    }
  | {
      apply: true
      expectedCount: number
      expectedManifestSha256: string
    }

const SHA256_PATTERN = /^[a-f0-9]{64}$/u

const parseSingleValue = (
  args: string[],
  prefix: string
): string | undefined => {
  const matches = args.filter((arg) => arg.startsWith(prefix))
  if (matches.length > 1) {
    throw new Error(`[money-migration] Duplicate argument: ${prefix}`)
  }
  return matches[0]?.slice(prefix.length)
}

export const parseMonetaryMigrationArguments = (
  args: string[]
): MonetaryMigrationArguments => {
  const allowed = args.every(
    (arg) =>
      arg === "--apply" ||
      arg.startsWith("--expected-count=") ||
      arg.startsWith("--expected-manifest-sha256=")
  )
  if (!allowed) {
    throw new Error("[money-migration] Unsupported argument.")
  }

  const apply = args.includes("--apply")
  const rawCount = parseSingleValue(args, "--expected-count=")
  const rawManifest = parseSingleValue(
    args,
    "--expected-manifest-sha256="
  )?.toLowerCase()

  if (!apply) {
    if (rawCount !== undefined || rawManifest !== undefined) {
      throw new Error(
        "[money-migration] Expected values are accepted only with --apply."
      )
    }
    return { apply: false }
  }

  const expectedCount = Number(rawCount)
  if (
    rawCount === undefined ||
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 0
  ) {
    throw new Error(
      "[money-migration] --expected-count must be a non-negative integer."
    )
  }
  if (!rawManifest || !SHA256_PATTERN.test(rawManifest)) {
    throw new Error(
      "[money-migration] --expected-manifest-sha256 must be a SHA-256 value."
    )
  }

  return {
    apply: true,
    expectedCount,
    expectedManifestSha256: rawManifest,
  }
}
