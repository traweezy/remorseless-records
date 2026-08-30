import { renderToStaticMarkup } from "react-dom/server"
import { createDataTableColumnHelper, useDataTable } from "@medusajs/ui"

import {
  AdminResponsiveDataTable,
  type AdminResponsiveDataTableProps,
} from "./admin-responsive-data-table"

type TestRow = {
  id: string
}

const columnHelper = createDataTableColumnHelper<TestRow>()
const columns = [
  columnHelper.accessor("id", {
    header: "ID",
  }),
]

type FixtureProps = Pick<
  AdminResponsiveDataTableProps<TestRow>,
  "mobile" | "showPagination"
>

const Fixture = ({ mobile, showPagination = true }: FixtureProps) => {
  const instance = useDataTable({
    columns,
    data: [],
    isLoading: true,
    pagination: {
      onPaginationChange: () => undefined,
      state: {
        pageIndex: 0,
        pageSize: 2,
      },
    },
    rowCount: 0,
  })

  return (
    <AdminResponsiveDataTable
      instance={instance}
      mobile={mobile}
      showPagination={showPagination}
    />
  )
}

describe("AdminResponsiveDataTable", () => {
  it("keeps custom mobile content and native desktop loading aligned", () => {
    const markup = renderToStaticMarkup(
      <Fixture
        mobile={
          <div aria-label="Loading mobile collection">Mobile skeleton</div>
        }
      />
    )

    expect(markup).toContain("Mobile skeleton")
    expect(markup).toContain("md:hidden")
    expect(markup).toContain("scroll-mt-16")
    expect(markup).toContain("hidden md:flex")
    expect(markup.match(/h-12 w-full/g)).toHaveLength(3)
  })

  it("can omit pagination for a settled empty collection", () => {
    const markup = renderToStaticMarkup(
      <Fixture mobile={<div>No records</div>} showPagination={false} />
    )

    expect(markup).toContain("No records")
    expect(markup).not.toContain("h-7 w-")
  })
})
