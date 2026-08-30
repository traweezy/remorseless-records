import { defineRouteConfig } from "@medusajs/admin-sdk"

import {
  adminPermissionKey,
  operationsAdminActions,
} from "../../../../lib/admin-permissions"
import { RefundOperationsPage } from "../../refund-operations/page"

export const config = defineRouteConfig({
  label: "Refunds",
  rank: 2,
})

export const handle = {
  breadcrumb: () => "Refunds",
  permissions: adminPermissionKey(operationsAdminActions.refundOperations.read),
}

export default RefundOperationsPage
