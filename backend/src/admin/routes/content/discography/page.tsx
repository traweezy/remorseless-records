import { defineRouteConfig } from "@medusajs/admin-sdk"

import { DiscographyAdminPage } from "../../discography/page"

export const config = defineRouteConfig({
  label: "Discography",
  rank: 2,
})

export const handle = {
  breadcrumb: () => "Discography",
}

export default DiscographyAdminPage
