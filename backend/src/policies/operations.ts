import { definePolicies } from "@medusajs/framework/utils"

import { operationsAdminPolicyDefinitions } from "../lib/admin-permissions"

export const operationsPolicies = definePolicies(
  operationsAdminPolicyDefinitions
)
