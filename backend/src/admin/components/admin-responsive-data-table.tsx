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

type BrowserEnvironment = typeof globalThis & {
  matchMedia?: (query: string) => {
    matches: boolean
  }
}

type ScrollTarget = {
  scrollIntoView: (options: {
    behavior: "auto" | "smooth"
    block: "start"
  }) => void
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

    const browserEnvironment = globalThis as BrowserEnvironment
    if (
      !mobileCollectionRef.current ||
      !browserEnvironment.matchMedia ||
      browserEnvironment.matchMedia("(min-width: 768px)").matches
    ) {
      return
    }

    const reduceMotion = browserEnvironment.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    const scrollTarget = mobileCollectionRef.current as unknown as ScrollTarget
    scrollTarget.scrollIntoView({
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
