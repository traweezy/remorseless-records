import { renderToStaticMarkup } from "react-dom/server"

import { useDiscographyColumns } from "./discography-table"

const noop = (): void => undefined

const ColumnsProbe = ({
  canReadProducts,
  canUpdate,
}: {
  canReadProducts: boolean
  canUpdate: boolean
}) => {
  const columns = useDiscographyColumns({
    busyEntryId: null,
    canReadProducts,
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

describe("Discography table permissions", () => {
  it("omits the entire actions column for fully read-only roles", () => {
    const markup = renderToStaticMarkup(
      <ColumnsProbe canReadProducts={false} canUpdate={false} />
    )

    expect(markup).not.toContain(">actions<")
  })

  it.each([
    [true, false],
    [false, true],
  ])(
    "includes actions when product reading is %s and updating is %s",
    (canReadProducts, canUpdate) => {
      const markup = renderToStaticMarkup(
        <ColumnsProbe canReadProducts={canReadProducts} canUpdate={canUpdate} />
      )

      expect(markup).toContain(">actions<")
    }
  )
})
