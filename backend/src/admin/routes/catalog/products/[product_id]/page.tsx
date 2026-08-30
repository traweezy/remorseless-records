"use client"

import { memo } from "react"
import { useParams } from "react-router-dom"

import {
  adminPermissionKey,
  catalogAdminActions,
} from "../../../../../lib/admin-permissions"
import { ProductAuthoringWorkspace } from "../../../catalog-authoring/page"

const CatalogProductEditorPage = memo(() => {
  const { product_id: productId } = useParams<{ product_id: string }>()

  return productId ? <ProductAuthoringWorkspace productId={productId} /> : null
})

CatalogProductEditorPage.displayName = "CatalogProductEditorPage"

export const handle = {
  breadcrumb: () => "Catalog details",
  permissions: adminPermissionKey(catalogAdminActions.authoring.read),
  seo: () => ({
    title: "Catalog details",
  }),
}

export default CatalogProductEditorPage
