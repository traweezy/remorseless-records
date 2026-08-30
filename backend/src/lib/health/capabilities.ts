import { isAdminRbacEnabled } from "../admin-rbac-config"
import { resolveObjectStorageConfig } from "../storage/config"

export const operationalCapabilityNames = [
  "payment",
  "tax",
  "notification",
  "payment_lifecycle",
  "search",
  "object_storage",
  "admin_rbac",
] as const

export type OperationalCapabilityName =
  (typeof operationalCapabilityNames)[number]

export type OperationalCapability = {
  name: OperationalCapabilityName
  ready: boolean
  reason: "configured" | "configuration_incomplete"
}

type CapabilityEnvironment = Readonly<Record<string, string | undefined>>

const present = (value: string | undefined): boolean => Boolean(value?.trim())
const allPresent = (...values: Array<string | undefined>): boolean =>
  values.every(present)

const storageReady = (environment: CapabilityEnvironment): boolean => {
  try {
    return Boolean(
      resolveObjectStorageConfig({
        environment,
        required: true,
      })
    )
  } catch {
    return false
  }
}

const taxReady = (environment: CapabilityEnvironment): boolean => {
  const provider = environment.TAX_RATE_LOOKUP_PROVIDER?.trim() || "taxrate_io"
  if (provider === "taxrate_io") {
    return (
      (environment.TAX_RATE_LOOKUP_MODE?.trim() || "zip") === "zip" &&
      present(environment.TAX_RATE_LOOKUP_API_KEY)
    )
  }
  if (provider === "stripe_tax") {
    return (
      present(environment.STRIPE_API_KEY) &&
      /^txcd_\d{8}$/u.test(
        environment.STRIPE_TAX_SHIPPING_TAX_CODE?.trim() ?? ""
      )
    )
  }
  return false
}

const capability = (
  name: OperationalCapabilityName,
  ready: boolean
): OperationalCapability => ({
  name,
  ready,
  reason: ready ? "configured" : "configuration_incomplete",
})

export const resolveOperationalCapabilities = (
  environment: CapabilityEnvironment = process.env
): OperationalCapability[] => [
  capability(
    "payment",
    allPresent(
      environment.STRIPE_API_KEY,
      environment.STRIPE_WEBHOOK_SECRET,
      environment.STRIPE_PAYMENT_METHOD_CONFIGURATION
    )
  ),
  capability("tax", taxReady(environment)),
  capability(
    "notification",
    allPresent(
      environment.RESEND_API_KEY,
      environment.RESEND_FROM_EMAIL ?? environment.RESEND_FROM
    ) ||
      allPresent(
        environment.SENDGRID_API_KEY,
        environment.SENDGRID_FROM_EMAIL ?? environment.SENDGRID_FROM
      )
  ),
  capability(
    "payment_lifecycle",
    allPresent(
      environment.STRIPE_API_KEY,
      environment.STRIPE_LIFECYCLE_WEBHOOK_SECRET
    )
  ),
  capability(
    "search",
    allPresent(environment.MEILISEARCH_HOST, environment.MEILISEARCH_ADMIN_KEY)
  ),
  capability("object_storage", storageReady(environment)),
  capability("admin_rbac", isAdminRbacEnabled(environment.MEDUSA_FF_RBAC)),
]

export const assertOperationalCapabilities = ({
  environment = process.env,
  required,
}: {
  environment?: CapabilityEnvironment
  required: boolean
}): OperationalCapability[] => {
  const checks = resolveOperationalCapabilities(environment)
  const missing = checks.filter((check) => !check.ready).map(({ name }) => name)
  if (required && missing.length) {
    throw new Error(
      `Required operational capabilities are incomplete: ${missing.join(", ")}`
    )
  }
  return checks
}
