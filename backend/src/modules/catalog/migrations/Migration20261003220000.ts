import { Migration } from "@mikro-orm/migrations"

import { normalizeLegacyCatalogDescriptions } from "../../../lib/catalog/normalize-legacy-descriptions"

export class Migration20261003220000 extends Migration {
  override async up(): Promise<void> {
    await normalizeLegacyCatalogDescriptions((sql, parameters) =>
      this.execute(sql, parameters)
    )
  }

  override async down(): Promise<void> {
    // Retain canonical safe HTML on rollback. The pre-release backup preserves
    // the original import; application rollback must not reintroduce embeds.
  }
}
