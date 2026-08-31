import type {
  CatalogMediaAssetRecord,
  CatalogProductMediaItemRecord,
  CatalogProductProfileRecord,
} from "@/modules/catalog/serializers"

export const catalogMediaAssetFixture = (
  overrides: Partial<CatalogMediaAssetRecord> = {}
): CatalogMediaAssetRecord => ({
  alt_text: "Cover",
  byte_size: 1_024,
  caption: null,
  content_sha256: null,
  created_at: "2026-08-30T00:00:00.000Z",
  crop_intent: null,
  derivative_status: "source_only",
  derivatives: {},
  focal_x: 0.5,
  focal_y: 0.5,
  height: 1_000,
  id: "cmedia_1",
  lifecycle_status: "active",
  metadata: {},
  mime_type: "image/jpeg",
  original_filename: "cover.jpg",
  purge_eligible_at: null,
  quarantined_at: null,
  quarantined_by: null,
  source_file_key: "covers/cover.jpg",
  source_url: "https://media.example/cover.jpg",
  updated_at: "2026-08-30T00:00:00.000Z",
  version: 1,
  width: 1_000,
  ...overrides,
})

export const catalogProductMediaItemFixture = (
  overrides: Partial<CatalogProductMediaItemRecord> = {}
): CatalogProductMediaItemRecord => ({
  created_at: "2026-08-30T00:00:00.000Z",
  id: "cpmedia_1",
  is_primary: true,
  media_asset_id: "cmedia_1",
  metadata: {},
  product_id: "prod_1",
  product_profile_id: "cprof_1",
  role: "primary",
  sort_order: 0,
  updated_at: "2026-08-30T00:00:00.000Z",
  variant_id: null,
  ...overrides,
})

export const catalogProductProfileFixture = (
  overrides: Partial<CatalogProductProfileRecord> = {}
): CatalogProductProfileRecord => ({
  content_schema_version: 1,
  created_at: "2026-08-30T00:00:00.000Z",
  credits: {},
  description_html: null,
  id: "cprof_1",
  label_id: null,
  merch_details: {},
  metadata: {},
  pressing_notes: {},
  product_id: "prod_1",
  product_type_id: null,
  release_date: null,
  release_date_precision: "unknown",
  release_title: null,
  release_year: null,
  search_keywords: [],
  tracklist: [],
  updated_at: "2026-08-30T00:00:00.000Z",
  version: 1,
  ...overrides,
})

export type CatalogOperationFixtureOverrides = Record<string, unknown> & {
  status?: "compensated" | "failed" | "pending" | "succeeded"
}

export const catalogOperationFixture = (
  overrides: CatalogOperationFixtureOverrides = {}
): Record<string, unknown> => {
  const status = overrides.status ?? "pending"
  const completed = status !== "pending"
  const compensated = status === "compensated"
  const failed = status === "failed"
  return {
    actor_id: "user_1",
    aggregate_id: "prod_1",
    command: "catalog.product-media.replace",
    completed_at: completed ? "2026-08-30T00:05:00.000Z" : null,
    error_code: compensated
      ? "workflow_compensated"
      : failed
        ? "workflow_compensation_failed"
        : null,
    error_detail: compensated
      ? "The prior state was restored."
      : failed
        ? "Cleanup requires operator reconciliation."
        : null,
    expected_version: 0,
    id: "catop_1",
    idempotency_key: "00000000-0000-4000-8000-000000000001",
    metadata: {},
    request_sha256: "a".repeat(64),
    result: {},
    status,
    ...overrides,
  }
}
