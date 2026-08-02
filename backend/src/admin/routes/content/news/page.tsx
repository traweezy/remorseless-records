import { defineRouteConfig } from "@medusajs/admin-sdk"

import {
  adminPermissionKey,
  contentAdminActions,
} from "../../../../lib/admin-permissions"
import { NewsAdminPage } from "../../news/page"

export const config = defineRouteConfig({
  label: "News",
  rank: 1,
})

export const handle = {
  breadcrumb: () => "News",
  permissions: adminPermissionKey(contentAdminActions.news.read),
}

export default NewsAdminPage
