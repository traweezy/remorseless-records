import { definePolicies } from "@medusajs/framework/utils"

import { catalogAdminPolicyDefinitions } from "../lib/admin-permissions"

export const catalogPolicies = definePolicies(catalogAdminPolicyDefinitions)
