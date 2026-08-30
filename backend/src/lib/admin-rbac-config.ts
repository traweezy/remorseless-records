import { Modules } from "@medusajs/framework/utils"

type ResolveAdminRbacModuleConfigOptions = Readonly<{
  requireEnabled: boolean
}>

export const isAdminRbacEnabled = (
  value: boolean | string | undefined
): boolean =>
  value === true ||
  (typeof value === "string" && value.toLowerCase() === "true")

export const resolveAdminRbacModuleConfig = (
  value: boolean | string | undefined,
  { requireEnabled }: ResolveAdminRbacModuleConfigOptions
) => {
  const enabled = isAdminRbacEnabled(value)
  if (requireEnabled && !enabled) {
    throw new Error("MEDUSA_FF_RBAC must be set to true in production.")
  }

  return {
    disable: !enabled,
    key: Modules.RBAC,
    resolve: "@medusajs/medusa/rbac",
  }
}
