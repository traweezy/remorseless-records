import { defineRouteConfig } from "@medusajs/admin-sdk"

import {
  adminPermissionKey,
  contentAdminActions,
} from "../../../../lib/admin-permissions"
import { DiscographyAdminPage } from "../../discography/page"

export const config = defineRouteConfig({
  label: "Discography",
  rank: 2,
})

export const handle = {
  breadcrumb: () => "Discography",
  permissions: adminPermissionKey(contentAdminActions.discography.read),
}

export default DiscographyAdminPage
