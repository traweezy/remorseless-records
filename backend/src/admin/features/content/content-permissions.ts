import {
  contentAdminActions,
  nativeAdminActions,
  type AdminPolicyAction,
} from "../../../lib/admin-permissions"

export const discographyReadActions = [
  contentAdminActions.discography.read,
  nativeAdminActions.product.read,
] as const satisfies readonly AdminPolicyAction[]

export const hasDiscographyReadAccess = (
  hasPermission: (action: AdminPolicyAction) => boolean,
): boolean => discographyReadActions.every(hasPermission)
