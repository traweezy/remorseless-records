"use client"

import {
  memo,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react"
import {
  DataTable,
  type DataTableEmptyStateProps,
  type UseDataTableReturn,
} from "@medusajs/ui"

export type AdminResponsiveDataTableProps<TData> = {
  desktopEmptyState?: DataTableEmptyStateProps
  instance: UseDataTableReturn<TData>
  mobile: ReactNode
  showPagination?: boolean
}

const AdminResponsiveDataTableComponent = <TData,>({
  desktopEmptyState,
  instance,
  mobile,
  showPagination = true,
}: AdminResponsiveDataTableProps<TData>): ReactElement => {
  const mobileCollectionRef = useRef<HTMLDivElement>(null)
  const previousPageIndexRef = useRef(instance.pageIndex)

  useEffect(() => {
    if (previousPageIndexRef.current === instance.pageIndex) {
      return
    }
    previousPageIndexRef.current = instance.pageIndex

    if (
      !mobileCollectionRef.current ||
      typeof globalThis.matchMedia !== "function" ||
      globalThis.matchMedia("(min-width: 768px)").matches
    ) {
      return
    }

    const reduceMotion = globalThis.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    mobileCollectionRef.current.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    })
  }, [instance.pageIndex])

  return (
    <>
      <div className="mt-4 scroll-mt-16 md:hidden" ref={mobileCollectionRef}>
        <DataTable instance={instance}>
          {mobile}
          {showPagination ? <DataTable.Pagination /> : null}
        </DataTable>
      </div>
      <DataTable className="mt-4 hidden md:flex" instance={instance}>
        <DataTable.Table
          {...(desktopEmptyState ? { emptyState: desktopEmptyState } : {})}
        />
        {showPagination ? <DataTable.Pagination /> : null}
      </DataTable>
    </>
  )
}

const MemoizedAdminResponsiveDataTable = memo(AdminResponsiveDataTableComponent)

MemoizedAdminResponsiveDataTable.displayName = "AdminResponsiveDataTable"

export const AdminResponsiveDataTable =
  MemoizedAdminResponsiveDataTable as typeof AdminResponsiveDataTableComponent
