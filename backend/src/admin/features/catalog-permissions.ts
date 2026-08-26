import {
  catalogAdminActions,
  nativeAdminActions,
  type AdminPolicyAction,
} from "../../lib/admin-permissions"

export const catalogProductSummaryReadActions = [
  catalogAdminActions.authoring.read,
  catalogAdminActions.taxonomy.read,
  nativeAdminActions.product.read,
  nativeAdminActions.productVariant.read,
  nativeAdminActions.price.read,
  nativeAdminActions.inventoryItem.read,
  nativeAdminActions.inventoryLevel.read,
] as const satisfies readonly AdminPolicyAction[]

export const catalogVariantProfileActions = [
  catalogAdminActions.authoring.read,
  catalogAdminActions.authoring.update,
  catalogAdminActions.taxonomy.read,
  catalogAdminActions.taxonomy.create,
  nativeAdminActions.product.read,
  nativeAdminActions.productVariant.read,
] as const satisfies readonly AdminPolicyAction[]

export const catalogMerchandisingWorkspaceActions = [
  catalogAdminActions.merchandising.read,
  catalogAdminActions.merchandising.create,
  catalogAdminActions.merchandising.update,
  nativeAdminActions.product.read,
] as const satisfies readonly AdminPolicyAction[]

export const catalogProductCreateActions = [
  catalogAdminActions.authoring.read,
  catalogAdminActions.authoring.create,
  catalogAdminActions.authoring.update,
  catalogAdminActions.taxonomy.read,
  catalogAdminActions.taxonomy.create,
  nativeAdminActions.file.create,
  nativeAdminActions.product.read,
  nativeAdminActions.product.create,
  nativeAdminActions.productVariant.read,
  nativeAdminActions.inventoryItem.read,
  nativeAdminActions.inventoryItem.create,
  nativeAdminActions.inventoryLevel.create,
  nativeAdminActions.price.create,
] as const satisfies readonly AdminPolicyAction[]

export const catalogProductEditActions = [
  catalogAdminActions.authoring.read,
  catalogAdminActions.authoring.update,
  catalogAdminActions.authoring.delete,
  catalogAdminActions.taxonomy.read,
  catalogAdminActions.taxonomy.create,
  nativeAdminActions.product.read,
  nativeAdminActions.product.update,
  nativeAdminActions.productVariant.read,
  nativeAdminActions.inventoryItem.read,
  nativeAdminActions.inventoryItem.create,
  nativeAdminActions.inventoryItem.update,
  nativeAdminActions.inventoryItem.delete,
] as const satisfies readonly AdminPolicyAction[]
