"use client";

import {
  memo,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  DataTable,
  type DataTableEmptyStateProps,
  type UseDataTableReturn,
} from "@medusajs/ui";

export type AdminResponsiveDataTableProps<TData> = {
  desktopEmptyState?: DataTableEmptyStateProps;
  instance: UseDataTableReturn<TData>;
  mobile: ReactNode;
  showPagination?: boolean;
};

const AdminResponsiveDataTableComponent = <TData,>({
  desktopEmptyState,
  instance,
  mobile,
  showPagination = true,
}: AdminResponsiveDataTableProps<TData>): ReactElement => (
  <>
    <DataTable className="mt-4 md:hidden" instance={instance}>
      {mobile}
      {showPagination ? <DataTable.Pagination /> : null}
    </DataTable>
    <DataTable className="mt-4 hidden md:flex" instance={instance}>
      <DataTable.Table
        {...(desktopEmptyState ? { emptyState: desktopEmptyState } : {})}
      />
      {showPagination ? <DataTable.Pagination /> : null}
    </DataTable>
  </>
);

const MemoizedAdminResponsiveDataTable = memo(
  AdminResponsiveDataTableComponent,
);

MemoizedAdminResponsiveDataTable.displayName = "AdminResponsiveDataTable";

export const AdminResponsiveDataTable =
  MemoizedAdminResponsiveDataTable as typeof AdminResponsiveDataTableComponent;
