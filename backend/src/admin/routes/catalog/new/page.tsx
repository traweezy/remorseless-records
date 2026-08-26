"use client"

import {
  adminPermissionKey,
  catalogAdminActions,
} from "../../../../lib/admin-permissions"
import { CatalogProductCreatePage } from "../../../features/catalog-creation/catalog-product-create-page"

export const handle = {
  breadcrumb: () => "Create catalog product",
  permissions: adminPermissionKey(catalogAdminActions.authoring.create),
  seo: () => ({ title: "Create catalog product" }),
}

export default CatalogProductCreatePage
