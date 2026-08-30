"use client"

import { useCallback, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { z } from "zod"

import {
  adminPermissionKey,
  type AdminPolicyAction,
} from "../../lib/admin-permissions"
import { requestAdminJson } from "./admin-request"

const FIVE_MINUTES_MS = 5 * 60 * 1_000
const TEN_MINUTES_MS = 10 * 60 * 1_000

const adminFeatureFlagsSchema = z.object({
  feature_flags: z.record(z.string(), z.boolean()),
})

const adminPermissionsSchema = z.object({
  permissions: z.array(z.string()),
})

export type AdminFeatureFlags = z.infer<
  typeof adminFeatureFlagsSchema
>["feature_flags"]
export type AdminPermissionsResponse = z.infer<typeof adminPermissionsSchema>

export const adminFeatureFlagsQueryKey = ["admin", "feature-flags"] as const
export const adminPermissionsQueryKey = ["me-permissions"] as const

export const fetchAdminFeatureFlags = async (
  signal?: AbortSignal
): Promise<AdminFeatureFlags> => {
  const response = await requestAdminJson({
    path: "/admin/feature-flags",
    schema: adminFeatureFlagsSchema,
    ...(signal ? { signal } : {}),
  })
  return response.feature_flags
}

export const fetchAdminPermissions = async (
  signal?: AbortSignal
): Promise<AdminPermissionsResponse> =>
  requestAdminJson({
    path: "/admin/rbac/me/permissions",
    schema: adminPermissionsSchema,
    ...(signal ? { signal } : {}),
  })

export const isAdminPermissionGranted = (
  rbacEnabled: boolean,
  permissions: ReadonlySet<string>,
  action: AdminPolicyAction
): boolean => !rbacEnabled || permissions.has(adminPermissionKey(action))

export type UseAdminPermissionsResult = {
  error: unknown
  hasPermission: (action: AdminPolicyAction) => boolean
  hasSomePermission: (actions: readonly AdminPolicyAction[]) => boolean
  isPending: boolean
  isRetrying: boolean
  permissionKeys: ReadonlySet<string>
  rbacEnabled: boolean
  retry: () => void
}

export const useAdminPermissions = (): UseAdminPermissionsResult => {
  const featureFlagsQuery = useQuery({
    gcTime: TEN_MINUTES_MS,
    queryFn: ({ signal }) => fetchAdminFeatureFlags(signal),
    queryKey: adminFeatureFlagsQueryKey,
    retry: false,
    staleTime: FIVE_MINUTES_MS,
  })
  const rbacEnabled = featureFlagsQuery.data?.rbac === true
  const permissionsQuery = useQuery({
    enabled: featureFlagsQuery.isSuccess && rbacEnabled,
    gcTime: TEN_MINUTES_MS,
    queryFn: ({ signal }) => fetchAdminPermissions(signal),
    queryKey: adminPermissionsQueryKey,
    retry: false,
    staleTime: FIVE_MINUTES_MS,
  })
  const permissionKeys = useMemo<ReadonlySet<string>>(
    () => new Set(permissionsQuery.data?.permissions ?? []),
    [permissionsQuery.data?.permissions]
  )
  const hasPermission = useCallback(
    (action: AdminPolicyAction) =>
      isAdminPermissionGranted(rbacEnabled, permissionKeys, action),
    [permissionKeys, rbacEnabled]
  )
  const hasSomePermission = useCallback(
    (actions: readonly AdminPolicyAction[]) =>
      actions.some((action) => hasPermission(action)),
    [hasPermission]
  )
  const refetchFeatureFlags = featureFlagsQuery.refetch
  const refetchPermissions = permissionsQuery.refetch
  const retry = useCallback(() => {
    void refetchFeatureFlags().then((result) => {
      if (result.data?.rbac === true) {
        void refetchPermissions()
      }
    })
  }, [refetchFeatureFlags, refetchPermissions])

  return useMemo(
    () => ({
      error:
        featureFlagsQuery.error ??
        (rbacEnabled ? permissionsQuery.error : null),
      hasPermission,
      hasSomePermission,
      isPending:
        featureFlagsQuery.isPending ||
        (rbacEnabled && permissionsQuery.isPending),
      isRetrying:
        featureFlagsQuery.isFetching ||
        (rbacEnabled && permissionsQuery.isFetching),
      permissionKeys,
      rbacEnabled,
      retry,
    }),
    [
      featureFlagsQuery.error,
      featureFlagsQuery.isFetching,
      featureFlagsQuery.isPending,
      hasPermission,
      hasSomePermission,
      permissionKeys,
      permissionsQuery.error,
      permissionsQuery.isFetching,
      permissionsQuery.isPending,
      rbacEnabled,
      retry,
    ]
  )
}
