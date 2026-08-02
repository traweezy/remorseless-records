import { definePolicies } from "@medusajs/framework/utils";

import { contentAdminPolicyDefinitions } from "../lib/admin-permissions";

export const contentPolicies = definePolicies(contentAdminPolicyDefinitions);
