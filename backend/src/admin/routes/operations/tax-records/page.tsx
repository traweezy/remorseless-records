import { defineRouteConfig } from "@medusajs/admin-sdk"

import {
  adminPermissionKey,
  operationsAdminActions,
} from "../../../../lib/admin-permissions"
import { TaxRecordsPage } from "../../tax-records/page"

export const config = defineRouteConfig({
  label: "Tax records",
  rank: 1,
})

export const handle = {
  breadcrumb: () => "Tax records",
  permissions: adminPermissionKey(operationsAdminActions.taxRecords.read),
}

export default TaxRecordsPage
