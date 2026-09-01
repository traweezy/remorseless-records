import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFile(join(repositoryRoot, path), "utf8")

const [backendWorkflow, compose, integrationTest, orchestrator, packageSource] =
  await Promise.all([
    read(".github/workflows/backend.yml"),
    read("compose.integration.yml"),
    read("backend/integration-tests/disposable-infrastructure.test.ts"),
    read("scripts/run-disposable-integration.mjs"),
    read("package.json"),
  ])

for (const source of [backendWorkflow, compose]) {
  assert.match(
    source,
    /postgres:18\.6-alpine3\.24@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2/u
  )
  assert.match(
    source,
    /redis:8\.10\.1-alpine3\.23@sha256:becdda6c7f4b3fb42e42fd7f120bbf5c54c4caaaf16f26da24e4563d2c1f0576/u
  )
}
for (const marker of [
  "applies custom migrations and preserves the safe tax default",
  "persists an idempotent payment failure and bounded retry",
  "serializes distributed work and reacquires after release",
]) {
  assert.ok(
    integrationTest.includes(marker),
    `Integration proof lost: ${marker}`
  )
}
for (const marker of [
  "qa:disposable-integration:services",
  "needs: [unit, integration]",
  'STRIPE_API_KEY: ""',
  'STRIPE_LIFECYCLE_WEBHOOK_SECRET: ""',
  'STRIPE_PAYMENT_METHOD_CONFIGURATION: ""',
  'STRIPE_WEBHOOK_SECRET: ""',
]) {
  assert.ok(backendWorkflow.includes(marker), `Backend CI gate lost: ${marker}`)
}
for (const marker of [
  "127.0.0.1:${RR_INTEGRATION_POSTGRES_PORT:-55432}:5432",
  "127.0.0.1:${RR_INTEGRATION_REDIS_PORT:-56379}:6379",
]) {
  assert.ok(compose.includes(marker), `Loopback binding lost: ${marker}`)
}
for (const marker of [
  'process.on("SIGINT", handleInterrupt)',
  'process.on("SIGTERM", handleTermination)',
  '"--volumes"',
  '"--remove-orphans"',
]) {
  assert.ok(orchestrator.includes(marker), `Cleanup guard lost: ${marker}`)
}

const packageManifest = JSON.parse(packageSource)
assert.equal(
  packageManifest.scripts?.["qa:disposable-integration"],
  "node scripts/run-disposable-integration.mjs"
)
assert.equal(
  packageManifest.scripts?.["qa:disposable-integration:services"],
  "pnpm --filter backend run test:integration && pnpm run qa:api-contract"
)
assert.match(
  packageManifest.scripts?.["qa:lint"] ?? "",
  /pnpm run qa:disposable-integration-boundary/u
)
