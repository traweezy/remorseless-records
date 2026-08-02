import { Modules } from "@medusajs/framework/utils";

export const isAdminRbacEnabled = (value: string | undefined): boolean =>
  typeof value === "string" && value.toLowerCase() === "true";

export const resolveAdminRbacModuleConfig = (value: string | undefined) => ({
  disable: !isAdminRbacEnabled(value),
  key: Modules.RBAC,
  resolve: "@medusajs/medusa/rbac",
});
