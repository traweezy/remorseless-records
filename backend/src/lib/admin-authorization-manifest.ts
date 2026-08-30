import type { MiddlewareRoute } from "@medusajs/framework/http"

import {
  type AdminPolicyAction,
  catalogAdminActions,
  contentAdminActions,
  nativeAdminActions,
  operationsAdminActions,
  productImportAdminActions,
} from "./admin-permissions"

export const adminHttpMethods = [
  "DELETE",
  "GET",
  "PATCH",
  "POST",
  "PUT",
] as const

export type AdminHttpMethod = (typeof adminHttpMethods)[number]
export type AdminRouteTemplate = `/admin/${string}`

export type AdminAuthorizationArea =
  | "catalog"
  | "content"
  | "operations"
  | "product_import"
  | "uploads"

export type AdminAuthorizationManifestEntry = Readonly<{
  area: AdminAuthorizationArea
  method: AdminHttpMethod
  policies: readonly [AdminPolicyAction, ...AdminPolicyAction[]]
  template: AdminRouteTemplate
}>

const authorize = (
  area: AdminAuthorizationArea,
  method: AdminHttpMethod,
  template: AdminRouteTemplate,
  ...policies: [AdminPolicyAction, ...AdminPolicyAction[]]
): AdminAuthorizationManifestEntry => ({
  area,
  method,
  policies,
  template,
})

const { authoring, merchandising, taxonomy } = catalogAdminActions
const { mediaCleanup, refundOperations, taxControl, taxRecords } =
  operationsAdminActions
const { productImport } = productImportAdminActions

export const adminAuthorizationManifest = [
  authorize("catalog", "GET", "/admin/catalog/artists/:id", taxonomy.read),
  authorize("catalog", "PUT", "/admin/catalog/artists/:id", taxonomy.update),
  authorize("catalog", "DELETE", "/admin/catalog/artists/:id", taxonomy.delete),
  authorize("catalog", "GET", "/admin/catalog/artists", taxonomy.read),
  authorize("catalog", "POST", "/admin/catalog/artists", taxonomy.create),
  authorize(
    "catalog",
    "GET",
    "/admin/catalog/authoring-audit",
    authoring.read,
    taxonomy.read,
    nativeAdminActions.product.read
  ),
  authorize("catalog", "GET", "/admin/catalog/bundles", authoring.read),
  authorize(
    "catalog",
    "POST",
    "/admin/catalog/bundles",
    authoring.create,
    authoring.update,
    nativeAdminActions.product.read,
    nativeAdminActions.productVariant.read,
    nativeAdminActions.inventoryItem.read,
    nativeAdminActions.inventoryItem.create,
    nativeAdminActions.inventoryItem.update,
    nativeAdminActions.inventoryItem.delete
  ),
  authorize(
    "operations",
    "GET",
    "/admin/catalog/media/assets/:id",
    mediaCleanup.read
  ),
  authorize(
    "operations",
    "POST",
    "/admin/catalog/media/assets/:id/quarantine",
    mediaCleanup.update
  ),
  authorize(
    "operations",
    "POST",
    "/admin/catalog/media/assets/:id/restore",
    mediaCleanup.update
  ),
  authorize(
    "operations",
    "GET",
    "/admin/catalog/media/orphans",
    mediaCleanup.read
  ),
  authorize(
    "catalog",
    "POST",
    "/admin/catalog/media/uploads",
    authoring.create,
    nativeAdminActions.file.create
  ),
  authorize(
    "catalog",
    "GET",
    "/admin/catalog/products/:product_id/authoring-view",
    authoring.read,
    taxonomy.read,
    nativeAdminActions.product.read,
    nativeAdminActions.productVariant.read,
    nativeAdminActions.price.read,
    nativeAdminActions.inventoryItem.read,
    nativeAdminActions.inventoryLevel.read
  ),
  authorize(
    "catalog",
    "GET",
    "/admin/catalog/products/:product_id/bundle",
    authoring.read,
    nativeAdminActions.product.read
  ),
  authorize(
    "catalog",
    "PUT",
    "/admin/catalog/products/:product_id/bundle",
    authoring.update,
    nativeAdminActions.product.read,
    nativeAdminActions.productVariant.read,
    nativeAdminActions.inventoryItem.read,
    nativeAdminActions.inventoryItem.create,
    nativeAdminActions.inventoryItem.update,
    nativeAdminActions.inventoryItem.delete
  ),
  authorize(
    "catalog",
    "DELETE",
    "/admin/catalog/products/:product_id/bundle",
    authoring.delete,
    nativeAdminActions.product.read,
    nativeAdminActions.productVariant.read,
    nativeAdminActions.inventoryItem.read,
    nativeAdminActions.inventoryItem.delete
  ),
  authorize(
    "catalog",
    "GET",
    "/admin/catalog/products/:product_id/media",
    authoring.read,
    nativeAdminActions.product.read
  ),
  authorize(
    "catalog",
    "PUT",
    "/admin/catalog/products/:product_id/media",
    authoring.update,
    nativeAdminActions.product.read,
    nativeAdminActions.productVariant.read
  ),
  authorize(
    "catalog",
    "DELETE",
    "/admin/catalog/products/:product_id/media",
    authoring.delete
  ),
  authorize(
    "catalog",
    "GET",
    "/admin/catalog/products/:product_id/profile",
    authoring.read,
    nativeAdminActions.product.read
  ),
  authorize(
    "catalog",
    "PUT",
    "/admin/catalog/products/:product_id/profile",
    authoring.update,
    taxonomy.create,
    nativeAdminActions.product.read
  ),
  authorize(
    "catalog",
    "DELETE",
    "/admin/catalog/products/:product_id/profile",
    authoring.delete,
    merchandising.update
  ),
  authorize(
    "catalog",
    "POST",
    "/admin/catalog/products",
    authoring.create,
    authoring.update,
    taxonomy.create,
    nativeAdminActions.product.create,
    nativeAdminActions.productVariant.read,
    nativeAdminActions.inventoryItem.read,
    nativeAdminActions.inventoryItem.create,
    nativeAdminActions.inventoryLevel.create,
    nativeAdminActions.price.create
  ),
  authorize(
    "catalog",
    "GET",
    "/admin/catalog/products/status/:idempotency_key",
    authoring.read
  ),
  authorize(
    "catalog",
    "GET",
    "/admin/catalog/reference-values/:id",
    taxonomy.read
  ),
  authorize(
    "catalog",
    "PUT",
    "/admin/catalog/reference-values/:id",
    taxonomy.update
  ),
  authorize(
    "catalog",
    "DELETE",
    "/admin/catalog/reference-values/:id",
    taxonomy.delete
  ),
  authorize("catalog", "GET", "/admin/catalog/reference-values", taxonomy.read),
  authorize(
    "catalog",
    "POST",
    "/admin/catalog/reference-values",
    taxonomy.create
  ),
  authorize(
    "catalog",
    "GET",
    "/admin/catalog/shelves/:id/products",
    merchandising.read,
    nativeAdminActions.product.read
  ),
  authorize(
    "catalog",
    "PUT",
    "/admin/catalog/shelves/:id/products",
    merchandising.update,
    nativeAdminActions.product.read
  ),
  authorize(
    "catalog",
    "POST",
    "/admin/catalog/shelves/:id/restore",
    merchandising.update,
    nativeAdminActions.product.read
  ),
  authorize(
    "catalog",
    "GET",
    "/admin/catalog/shelves/:id",
    merchandising.read,
    nativeAdminActions.product.read
  ),
  authorize(
    "catalog",
    "PUT",
    "/admin/catalog/shelves/:id",
    merchandising.update,
    nativeAdminActions.product.read
  ),
  authorize(
    "catalog",
    "DELETE",
    "/admin/catalog/shelves/:id",
    merchandising.update
  ),
  authorize(
    "catalog",
    "GET",
    "/admin/catalog/shelves",
    merchandising.read,
    nativeAdminActions.product.read
  ),
  authorize(
    "catalog",
    "POST",
    "/admin/catalog/shelves",
    merchandising.create,
    nativeAdminActions.product.read
  ),
  authorize(
    "catalog",
    "GET",
    "/admin/catalog/variants/:variant_id/profile",
    authoring.read,
    nativeAdminActions.productVariant.read
  ),
  authorize(
    "catalog",
    "PUT",
    "/admin/catalog/variants/:variant_id/profile",
    authoring.update,
    taxonomy.create,
    nativeAdminActions.productVariant.read
  ),
  authorize(
    "catalog",
    "DELETE",
    "/admin/catalog/variants/:variant_id/profile",
    authoring.delete
  ),
  authorize(
    "content",
    "GET",
    "/admin/discography",
    contentAdminActions.discography.read,
    nativeAdminActions.product.read
  ),
  authorize(
    "content",
    "POST",
    "/admin/discography",
    contentAdminActions.discography.create
  ),
  authorize(
    "content",
    "GET",
    "/admin/discography/:id",
    contentAdminActions.discography.read,
    nativeAdminActions.product.read
  ),
  authorize(
    "content",
    "PUT",
    "/admin/discography/:id",
    contentAdminActions.discography.update
  ),
  authorize(
    "content",
    "DELETE",
    "/admin/discography/:id",
    contentAdminActions.discography.delete
  ),
  authorize(
    "content",
    "POST",
    "/admin/discography/:id/archive",
    contentAdminActions.discography.update
  ),
  authorize(
    "content",
    "POST",
    "/admin/discography/:id/restore",
    contentAdminActions.discography.update
  ),
  authorize(
    "uploads",
    "POST",
    "/admin/managed-uploads",
    nativeAdminActions.file.create
  ),
  authorize("content", "GET", "/admin/news", contentAdminActions.news.read),
  authorize("content", "POST", "/admin/news", contentAdminActions.news.create),
  authorize("content", "GET", "/admin/news/:id", contentAdminActions.news.read),
  authorize(
    "content",
    "PUT",
    "/admin/news/:id",
    contentAdminActions.news.update
  ),
  authorize(
    "content",
    "DELETE",
    "/admin/news/:id",
    contentAdminActions.news.delete
  ),
  authorize(
    "content",
    "POST",
    "/admin/news/:id/archive",
    contentAdminActions.news.update
  ),
  authorize(
    "content",
    "POST",
    "/admin/news/:id/restore",
    contentAdminActions.news.update
  ),
  authorize(
    "product_import",
    "POST",
    "/admin/products/imports",
    nativeAdminActions.product.read,
    nativeAdminActions.file.create,
    productImport.create
  ),
  authorize(
    "product_import",
    "POST",
    "/admin/products/imports/:transaction_id/confirm",
    nativeAdminActions.product.read,
    productImport.update
  ),
  authorize(
    "operations",
    "GET",
    "/admin/refund-operations",
    refundOperations.read
  ),
  authorize("operations", "GET", "/admin/tax-control", taxControl.read),
  authorize(
    "operations",
    "POST",
    "/admin/tax-control/switch",
    taxControl.update
  ),
  authorize(
    "operations",
    "POST",
    "/admin/tax-control/taxrate-io/refresh",
    taxControl.update
  ),
  authorize("operations", "GET", "/admin/tax-records", taxRecords.read),
  authorize("operations", "GET", "/admin/tax-records/export", taxRecords.read),
] as const satisfies readonly AdminAuthorizationManifestEntry[]

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const compileAdminRouteTemplate = (
  template: AdminRouteTemplate
): RegExp => {
  const segments = template.split("/")
  const pattern = segments
    .map((segment, index) => {
      if (index === 0) {
        return ""
      }
      if (/^:[a-z][a-z0-9_]*$/i.test(segment)) {
        return "[^/]+"
      }
      if (segment.includes(":")) {
        throw new Error(`Invalid Admin route template segment: ${segment}`)
      }
      return escapeRegExp(segment)
    })
    .join("\\/")

  return new RegExp(`^${pattern}\\/?$`, "i")
}

export const adminAuthorizationPolicyRoutes: MiddlewareRoute[] =
  adminAuthorizationManifest.map(({ method, policies, template }) => ({
    matcher: compileAdminRouteTemplate(template),
    methods: [method],
    policies: [...policies],
  }))

export const adminAuthorizationPolicyRoutesForArea = (
  area: AdminAuthorizationArea
): MiddlewareRoute[] =>
  adminAuthorizationPolicyRoutes.filter(
    (_route, index) => adminAuthorizationManifest[index]?.area === area
  )

export const adminAuthorizationKey = ({
  method,
  template,
}: Pick<AdminAuthorizationManifestEntry, "method" | "template">): string =>
  `${method} ${template}`
