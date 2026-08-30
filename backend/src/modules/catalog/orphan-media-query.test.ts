import { knex } from "@mikro-orm/knex"

import { buildOrphanCatalogMediaQueries } from "./orphan-media-query"

describe("orphan catalog media queries", () => {
  const database = knex({ client: "pg" })

  afterAll(async () => {
    await database.destroy()
  })

  it("builds a parameterized exact anti-join and bounded deterministic page", () => {
    const { countQuery, rowsQuery } = buildOrphanCatalogMediaQueries(database, {
      lifecycleStatus: "quarantined",
      limit: 25,
      offset: 50,
    })
    const count = countQuery.toSQL()
    const rows = rowsQuery.toSQL()

    expect(count.sql).toContain(
      'not exists (select 1 from "catalog_product_media" as "media"'
    )
    expect(count.sql).toContain('"media"."deleted_at" is null')
    expect(count.sql).toContain('"asset"."deleted_at" is null')
    expect(count.sql).toContain('"asset"."lifecycle_status" = ?')
    expect(count.bindings).toEqual(["quarantined"])
    expect(rows.sql).toContain(
      'order by "asset"."created_at" desc, "asset"."id" desc'
    )
    expect(rows.sql).toContain("limit ? offset ?")
    expect(rows.bindings).toEqual(["quarantined", 25, 50])
  })
})
