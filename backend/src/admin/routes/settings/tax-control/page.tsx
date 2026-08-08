import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingTax } from "@medusajs/icons"

import {
  adminPermissionKey,
  operationsAdminActions,
} from "../../../../lib/admin-permissions"
import { TaxControlPage } from "../../tax-control/page"

export const config = defineRouteConfig({
  icon: BuildingTax,
  label: "Tax control",
})

export const handle = {
  breadcrumb: () => "Tax control",
  permissions: adminPermissionKey(operationsAdminActions.taxControl.read),
}

export default TaxControlPage
