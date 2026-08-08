import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  adminPermissionKey,
  operationsAdminActions,
  type AdminPolicyAction,
} from "../../lib/admin-permissions";
import MediaCleanupPage, {
  handle as mediaCleanupHandle,
} from "./operations/media-cleanup/page";
import RefundOperationsPage, {
  handle as refundOperationsHandle,
} from "./operations/refunds/page";
import TaxControlPage, {
  handle as taxControlHandle,
} from "./settings/tax-control/page";
import TaxRecordsPage, {
  handle as taxRecordsHandle,
} from "./operations/tax-records/page";
import {
  adminFeatureFlagsQueryKey,
  adminPermissionsQueryKey,
} from "../lib/admin-permissions";

type ProtectedRoute = {
  action: AdminPolicyAction;
  Component: ComponentType;
  handle: { permissions: string };
  name: string;
};

const protectedRoutes: readonly ProtectedRoute[] = [
  {
    action: operationsAdminActions.mediaCleanup.read,
    Component: MediaCleanupPage,
    handle: mediaCleanupHandle,
    name: "Media cleanup",
  },
  {
    action: operationsAdminActions.refundOperations.read,
    Component: RefundOperationsPage,
    handle: refundOperationsHandle,
    name: "Refunds",
  },
  {
    action: operationsAdminActions.taxControl.read,
    Component: TaxControlPage,
    handle: taxControlHandle,
    name: "Tax control",
  },
  {
    action: operationsAdminActions.taxRecords.read,
    Component: TaxRecordsPage,
    handle: taxRecordsHandle,
    name: "Tax records",
  },
] as const;

const renderRouteWithoutPermissions = (Component: ComponentType): string => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(adminFeatureFlagsQueryKey, { rbac: true });
  queryClient.setQueryData(adminPermissionsQueryKey, { permissions: [] });

  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  );
  queryClient.clear();
  return markup;
};

describe("operations route permissions", () => {
  it.each(protectedRoutes)(
    "declares the $name route permission",
    ({ action, handle }) => {
      expect(handle.permissions).toBe(adminPermissionKey(action));
    },
  );

  it.each(protectedRoutes)(
    "fails closed before mounting the $name workspace",
    ({ Component, name }) => {
      const markup = renderRouteWithoutPermissions(Component);

      expect(markup).toContain("Access restricted");
      expect(markup).toContain("No protected content was loaded");
      expect(markup).toContain(`${name} workspace`);
    },
  );
});
