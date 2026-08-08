import { defineRouteConfig } from "@medusajs/admin-sdk"

import {
  adminPermissionKey,
  operationsAdminActions,
} from "../../../../lib/admin-permissions"
import { MediaCleanupPage } from "../../media-cleanup/page"

export const config = defineRouteConfig({
  label: "Media cleanup",
  rank: 3,
})

export const handle = {
  breadcrumb: () => "Media cleanup",
  permissions: adminPermissionKey(operationsAdminActions.mediaCleanup.read),
}

export default MediaCleanupPage
