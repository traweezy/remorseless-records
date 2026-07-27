const { spawnSync } = require("node:child_process")
const path = require("node:path")

const INDEX_PATTERN = /^products_build_[a-z0-9_-]+$/

const compactTimestamp = (date) => {
  return date.toISOString().toLowerCase().replace(/[-:.]/g, "")
}

const shortRevision = (
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  "local"
)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "")
  .slice(0, 12)

const candidateIndex =
  process.env.MEILISEARCH_CANDIDATE_INDEX?.trim() ??
  `products_build_${compactTimestamp(new Date())}_${shortRevision || "local"}`

if (!INDEX_PATTERN.test(candidateIndex)) {
  console.error(
    "MEILISEARCH_CANDIDATE_INDEX must match products_build_[a-z0-9_-]+."
  )
  process.exit(1)
}

const runner = path.resolve(__dirname, "run-medusa.js")
const rebuildScript = path.resolve(
  __dirname,
  "..",
  "src",
  "scripts",
  "reindex-meilisearch.ts"
)
const result = spawnSync(process.execPath, [runner, rebuildScript], {
  cwd: path.resolve(__dirname, ".."),
  env: {
    ...process.env,
    MEILISEARCH_CANDIDATE_INDEX: candidateIndex,
  },
  stdio: "inherit",
})

process.exit(result.status ?? 1)
