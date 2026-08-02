"use client"

import { memo, type ReactNode } from "react"
import { Alert, Container, Skeleton, Text } from "@medusajs/ui"

import type { AdminPolicyAction } from "../../lib/admin-permissions"
import { useAdminPermissions } from "../lib/admin-permissions"
import {
  AdminPageHeader,
  AdminSingleColumnLayout,
} from "./admin-page"
import { AdminRetryState } from "./admin-retry-state"

export type AdminPermissionBoundaryProps = {
  actions: AdminPolicyAction | readonly AdminPolicyAction[]
  children: ReactNode
  match?: "all" | "some"
  workspace: string
}

export const AdminPermissionBoundary = memo<
  AdminPermissionBoundaryProps
>(({ actions, children, match = "all", workspace }) => {
  const permissions = useAdminPermissions()
  const requiredActions = Array.isArray(actions) ? actions : [actions]
  const allowed =
    match === "some"
      ? requiredActions.some(permissions.hasPermission)
      : requiredActions.every(permissions.hasPermission)

  if (permissions.isPending) {
    return (
      <AdminSingleColumnLayout aria-busy="true" aria-label="Checking access">
        <Container>
          <Skeleton className="h-7 w-48 max-w-full" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          <Skeleton className="mt-6 h-8 w-72 max-w-full" />
        </Container>
        <Container>
          <Skeleton className="h-40 w-full" />
        </Container>
      </AdminSingleColumnLayout>
    )
  }

  if (permissions.error) {
    return (
      <AdminSingleColumnLayout>
        <AdminRetryState
          message="Your role could not be verified. No protected content was loaded."
          onRetry={permissions.retry}
          retrying={permissions.isRetrying}
          title="Access check could not complete"
        />
      </AdminSingleColumnLayout>
    )
  }

  if (!allowed) {
    return (
      <AdminSingleColumnLayout>
        <Container>
          <AdminPageHeader
            description={`Your administrator role does not include the ${workspace} workspace.`}
            title="Access restricted"
          />
          <Alert className="mt-5" variant="info">
            <Text size="small">
              Ask a super administrator to grant the required role permission.
              No protected content was loaded.
            </Text>
          </Alert>
        </Container>
      </AdminSingleColumnLayout>
    )
  }

  return children
})

AdminPermissionBoundary.displayName = "AdminPermissionBoundary"
