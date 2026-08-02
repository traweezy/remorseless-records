import { renderToStaticMarkup } from "react-dom/server"

import { useNewsColumns } from "./news-table"

const noop = (): void => undefined

const ColumnsProbe = ({ canUpdate }: { canUpdate: boolean }) => {
  const columns = useNewsColumns({
    busyEntryId: null,
    canUpdate,
    onEdit: noop,
    onLifecycle: noop,
  })
  return (
    <div>
      {columns.map((column) => (
        <span key={column.id}>{column.id}</span>
      ))}
    </div>
  )
}

describe("News table permissions", () => {
  it("omits the entire actions column for read-only roles", () => {
    const markup = renderToStaticMarkup(<ColumnsProbe canUpdate={false} />)

    expect(markup).not.toContain(">actions<")
  })

  it("includes actions for roles that can update News", () => {
    const markup = renderToStaticMarkup(<ColumnsProbe canUpdate />)

    expect(markup).toContain(">actions<")
  })
})
