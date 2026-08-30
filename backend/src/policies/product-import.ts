import { definePolicies } from "@medusajs/framework/utils"

import { productImportAdminPolicyDefinitions } from "../lib/admin-permissions"

export const productImportPolicies = definePolicies(
  productImportAdminPolicyDefinitions
)
