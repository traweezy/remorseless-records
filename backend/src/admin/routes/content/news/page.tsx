import { defineRouteConfig } from "@medusajs/admin-sdk"

import { NewsAdminPage } from "../../news/page"

export const config = defineRouteConfig({
  label: "News",
  rank: 1,
})

export const handle = {
  breadcrumb: () => "News",
}

export default NewsAdminPage
