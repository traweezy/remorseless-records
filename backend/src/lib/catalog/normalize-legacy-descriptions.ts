import { sanitizeRichTextHtml } from "../content/rich-text"
import { readNonNegativeSafeInteger } from "../provider-boundary/primitives"
import { readRecordArray } from "../provider-boundary/records"

type Execute = (
  sql: string,
  parameters: Array<string | number | null>
) => Promise<unknown>

// Called inside the migration transaction. Keep the HTML allowlist unchanged:
// imported descriptions predate the strict profile reader and must be brought
// into the same canonical form as new authoring writes.
export const normalizeLegacyCatalogDescriptions = async (
  execute: Execute
): Promise<{ examined: number; changed: number }> => {
  let after = ""
  let examined = 0
  let changed = 0
  for (let page = 0; page < 51; page += 1) {
    const rows = readRecordArray(
      await execute(
        "select id, description_html, version from catalog_product_profiles " +
          "where deleted_at is null and id > ? order by id limit 200 for update",
        [after]
      ),
      { context: "Catalog description migration" }
    )
    if (rows.length > 200 || examined + rows.length > 10_000) {
      throw new Error("Catalog description migration exceeded its row bound.")
    }
    for (const row of rows) {
      const id = row.id
      const description = row.description_html
      const version = readNonNegativeSafeInteger(row.version)
      if (
        typeof id !== "string" ||
        !/^cprof_[A-Za-z0-9_-]{1,249}$/u.test(id) ||
        id <= after ||
        version === null ||
        version < 1 ||
        version >= Number.MAX_SAFE_INTEGER ||
        (description !== null &&
          (typeof description !== "string" || description.length > 250_000))
      ) {
        throw new Error("Catalog description migration received invalid data.")
      }
      const normalized =
        description === null
          ? null
          : sanitizeRichTextHtml(description).trim() || null
      if (normalized !== description) {
        const updated = readRecordArray(
          await execute(
            "update catalog_product_profiles set description_html = ?, " +
              "version = version + 1, updated_at = now() " +
              "where id = ? and version = ? and deleted_at is null returning id, version",
            [normalized, id, version]
          ),
          { context: "Catalog description migration" }
        )
        if (
          updated.length !== 1 ||
          updated[0]?.id !== id ||
          updated[0]?.version !== version + 1
        ) {
          throw new Error(
            "Catalog description migration write was not acknowledged."
          )
        }
        changed += 1
      }
      examined += 1
      after = id
    }
    if (rows.length < 200) return { examined, changed }
  }
  throw new Error("Catalog description migration exceeded its page bound.")
}
