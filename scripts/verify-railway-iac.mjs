import assert from "node:assert/strict"
import fs from "node:fs"

import railwayProgram, { partial } from "../.railway/railway.ts"
import { createRailwayContext } from "railway/iac"

const legacyConfigPaths = ["backend/railway.json", "storefront/railway.json"]
const STOREFRONT_PRIVATE_REDIS_URL =
  "redis://${{Redis.REDISUSER}}:${{Redis.REDISPASSWORD}}@${{Redis.RAILWAY_PRIVATE_DOMAIN}}:6379"
const STOREFRONT_PRIVATE_MEILISEARCH_HOST = "${{Backend.MEILISEARCH_HOST}}"
const SHARED_BUILD_WATCH_PATTERNS = [
  "/.nvmrc",
  "/package.json",
  "/pnpm-lock.yaml",
  "/pnpm-workspace.yaml",
  "/patches/**",
]

for (const legacyConfigPath of legacyConfigPaths) {
  assert.equal(
    fs.existsSync(legacyConfigPath),
    false,
    `${legacyConfigPath} must not compete with project-level Railway IaC`
  )
}

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"))
const pnpmLock = fs.readFileSync("pnpm-lock.yaml", "utf8")
const pnpmWorkspace = fs.readFileSync("pnpm-workspace.yaml", "utf8")
const railwayCliPatch = fs.readFileSync(
  "patches/@railway__cli@5.45.0.patch",
  "utf8"
)
const railwayConfigWrapper = fs.readFileSync(
  "scripts/railway-config.mjs",
  "utf8"
)

assert.equal(packageJson.packageManager, "pnpm@11.17.0")
assert.equal(
  packageJson.devDependencies?.["@railway/cli"],
  "5.45.0",
  "Railway operations must use the reviewed, exact CLI version"
)
assert.equal(
  packageJson.devDependencies?.railway,
  "3.11.0",
  "Railway IaC must use the reviewed, exact SDK version"
)
assert.match(pnpmWorkspace, /^  "@railway\/cli": true$/mu)
assert.match(pnpmWorkspace, /^  "@railway\/cli>tar": 7\.5\.22$/mu)
assert.match(
  pnpmWorkspace,
  /^  "@railway\/cli@5\.45\.0": patches\/@railway__cli@5\.45\.0\.patch$/mu
)
assert.doesNotMatch(pnpmLock, /tar@6\.2\.1/u)
assert.match(pnpmLock, /tar@7\.5\.22/u)
assert.match(railwayCliPatch, /createHash\("sha256"\)/u)
assert.match(railwayCliPatch, /actualDigest !== expectedDigest/u)
assert.match(railwayCliPatch, /import \{ x as extract \} from "tar"/u)
assert.doesNotMatch(railwayCliPatch, /^\+import tar from "tar"/mu)
assert.match(
  railwayConfigWrapper,
  /id: "1f39263a-25e4-4d69-abc2-f0287b331d1e"/u,
  "Railway wrapper must guard the exact project ID"
)
assert.match(
  railwayConfigWrapper,
  /id: "799a2f98-f819-495d-b8b6-12e71af86568"/u,
  "Railway wrapper must guard the exact staging environment ID"
)
assert.match(
  railwayConfigWrapper,
  /configArgs\.push\("--yes", "--confirm-destructive"\)/u,
  "Non-interactive applies must explicitly confirm reviewed deletions"
)
assert.doesNotMatch(
  railwayConfigWrapper,
  /--show-values/u,
  "Railway wrapper must never expose variable values"
)

for (const digest of [
  "617b9d9db29d55616e4fe59b55e3586e8d8b994e11a665190384c74e235481d6",
  "d57b6d1c85361a0858ab006953d4f1b680485d90513c755e0346a179f6ec2b20",
  "f8d962a6011cc850ee0a3e1af0c03a5d59a1117e4f32ae77d968d557a4d6fbe9",
  "2e8325264c7171899c9d575ed30a62a8b78032d01fc24a3764d76d730fe83a37",
  "5abe40f3866d29922f9d58e8415c203311dca1c4b8225d6746d36b3d57472aea",
  "e830a83e264684ab7dcbb1a4aa9e54f593af2884f99c701ba206c970f4610f10",
  "9390030839753ab654a1b6b94a491cc14dc92f6be594b57a1f3cbe067f783955",
  "4110554cfe69a73ce3802e869b301bc2effcbdc491471bf4901644e0523802a5",
  "68688cd8ddcffbfcd3e117f7261758ac281727981c2698b5573223694f1d8ad4",
]) {
  assert.match(
    railwayCliPatch,
    new RegExp(digest, "u"),
    `Missing reviewed Railway release digest: ${digest}`
  )
}

delete process.env.RAILWAY_IAC_TARGET_ENVIRONMENT
assert.throws(
  () => railwayProgram(createRailwayContext()),
  /staging-only/u,
  "Railway IaC must fail closed without the guarded staging wrapper"
)

process.env.RAILWAY_IAC_TARGET_ENVIRONMENT = "staging"
const definition = await railwayProgram(
  createRailwayContext({
    environment: "staging",
    environmentName: "staging",
  })
)

assert.equal(definition.name, "store")
assert.equal(
  partial,
  "applications",
  "The stable partial name protects resources owned outside this repository slice"
)
assert.deepEqual(
  definition.resources.map(({ name }) => name).sort(),
  ["Backend", "Storefront"],
  "The application partial must not take ownership of data or support resources"
)

const getService = (name) => {
  const resource = definition.resources.find(
    (candidate) => candidate.type === "service" && candidate.name === name
  )

  assert.ok(resource, `Missing Railway service: ${name}`)
  return resource
}

const backend = getService("Backend")
const storefront = getService("Storefront")

assert.deepEqual(
  storefront.variables.REDIS_URL,
  { type: "literal", value: STOREFRONT_PRIVATE_REDIS_URL },
  "Storefront Redis must use Railway's private service reference"
)
assert.deepEqual(
  storefront.variables.MEILISEARCH_HOST,
  { type: "literal", value: STOREFRONT_PRIVATE_MEILISEARCH_HOST },
  "Storefront search must use the Backend's server-only Meilisearch host"
)
for (const name of ["NEXT_PUBLIC_MEILI_HOST", "NEXT_PUBLIC_MEILI_SEARCH_KEY"]) {
  assert.equal(
    Object.hasOwn(storefront.variables, name),
    false,
    `Storefront.${name} must not persist after the server-only migration`
  )
}
for (const name of ["MEDUSA_ADMIN_EMAIL", "MEDUSA_ADMIN_PASSWORD"]) {
  assert.equal(
    Object.hasOwn(backend.variables, name),
    false,
    `Backend.${name} must not persist in the normal application runtime`
  )
}

for (const service of [backend, storefront]) {
  assert.deepEqual(service.source, {
    type: "github",
    repo: "traweezy/remorseless-records",
    branch: "staging",
    checkSuites: true,
    rootDirectory: "/",
  })
  assert.equal(
    Object.hasOwn(service, "configFile"),
    false,
    `${service.name} must not use deprecated Config as Code`
  )
  assert.ok(
    Object.keys(service.variables).length > 0,
    `${service.name} must retain its imported variables`
  )

  for (const [name, value] of Object.entries(service.variables)) {
    if (
      service.name === "Storefront" &&
      ["MEILISEARCH_HOST", "REDIS_URL"].includes(name)
    ) {
      continue
    }

    assert.deepEqual(
      value,
      { type: "preserve" },
      `${service.name}.${name} must preserve its existing Railway value`
    )
  }
}

assert.deepEqual(backend.build, {
  builder: "RAILPACK",
  buildCommand: "pnpm --filter backend run build",
  buildEnvironment: "V3",
  watchPatterns: ["/backend/**", ...SHARED_BUILD_WATCH_PATTERNS],
})
assert.deepEqual(
  {
    startCommand: backend.deploy.startCommand,
    preDeployCommand: backend.deploy.preDeployCommand,
    healthcheckPath: backend.deploy.healthcheckPath,
    healthcheckTimeout: backend.deploy.healthcheckTimeout,
    restartPolicyType: backend.deploy.restartPolicyType,
    restartPolicyMaxRetries: backend.deploy.restartPolicyMaxRetries,
  },
  {
    startCommand: "pnpm --filter backend --silent run start",
    preDeployCommand: ["pnpm --filter backend --silent run release:prepare"],
    healthcheckPath: "/ready",
    healthcheckTimeout: 300,
    restartPolicyType: "ON_FAILURE",
    restartPolicyMaxRetries: 10,
  }
)

assert.deepEqual(storefront.build, {
  builder: "RAILPACK",
  buildCommand: "pnpm --filter remorseless-records-storefront run build",
  watchPatterns: ["/storefront/**", ...SHARED_BUILD_WATCH_PATTERNS],
})

assert.deepEqual(
  backend.build.watchPatterns.filter((pattern) =>
    storefront.build.watchPatterns.includes(pattern)
  ),
  SHARED_BUILD_WATCH_PATTERNS,
  "Both application builds must follow every shared toolchain input"
)
assert.equal(storefront.build.watchPatterns.includes("/backend/**"), false)
assert.equal(backend.build.watchPatterns.includes("/storefront/**"), false)
assert.deepEqual(
  {
    startCommand: storefront.deploy.startCommand,
    preDeployCommand: storefront.deploy.preDeployCommand,
    healthcheckPath: storefront.deploy.healthcheckPath,
    healthcheckTimeout: storefront.deploy.healthcheckTimeout,
    restartPolicyType: storefront.deploy.restartPolicyType,
    restartPolicyMaxRetries: storefront.deploy.restartPolicyMaxRetries,
  },
  {
    startCommand:
      "pnpm --filter remorseless-records-storefront --silent run start",
    preDeployCommand: [],
    healthcheckPath: "/ready",
    healthcheckTimeout: 180,
    restartPolicyType: "ON_FAILURE",
    restartPolicyMaxRetries: 10,
  }
)

const applicationCommands = [
  backend.build.buildCommand,
  backend.deploy.startCommand,
  ...backend.deploy.preDeployCommand,
  storefront.build.buildCommand,
  storefront.deploy.startCommand,
]

for (const command of applicationCommands) {
  assert.match(command, /^pnpm\b/u)
  assert.doesNotMatch(command, /(?:^|\s)(?:npm|yarn|bun)(?:\s|$)/u)
}

console.log(
  "Railway IaC verified: scoped staging ownership, pnpm-only commands, dependency readiness, and preserved secrets."
)
