import assert from "node:assert/strict"
import { readFileSync, realpathSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)))
const policyPath = join(
  root,
  "scripts",
  "security",
  "runtime-image-policy.json"
)
const expectedPolicy = {
  schemaVersion: 1,
  nodeImage:
    "node:26.5.0-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb",
  repository: "https://github.com/traweezy/remorseless-records",
  trivy: {
    repository: "aquasecurity/trivy-action",
    commit: "ed142fd0673e97e23eac54620cfb913e5ce36c25",
    version: "v0.36.0",
    scannerVersion: "v0.70.0",
    databaseRepository: "ghcr.io/aquasecurity/trivy-db",
  },
  actions: {
    attest: {
      repository: "actions/attest",
      version: "v4.2.2",
      commit: "1e69f48acb82d1966a394da916b4c1698aa569d6",
    },
    buildPush: {
      repository: "docker/build-push-action",
      version: "v7.3.0",
      commit: "53b7df96c91f9c12dcc8a07bcb9ccacbed38856a",
    },
    login: {
      repository: "docker/login-action",
      version: "v4.6.0",
      commit: "dbcb813823bdd20940b903addbd779551569679f",
    },
    setupBuildx: {
      repository: "docker/setup-buildx-action",
      version: "v4.3.0",
      commit: "37fe631027851001ddb9b187196cc803df7f5f0e",
    },
  },
  services: {
    backend: {
      dockerfile: "backend/Dockerfile.runtime",
      image: "ghcr.io/traweezy/remorseless-records-backend",
      port: 9000,
      workdir: "/app",
    },
    storefront: {
      dockerfile: "storefront/Dockerfile.runtime",
      image: "ghcr.io/traweezy/remorseless-records-storefront",
      port: 3000,
      workdir: "/app/storefront",
    },
  },
  workflow: ".github/workflows/runtime-images.yml",
}

export const validateRuntimeImagePolicyManifest = (policy) => {
  assert.deepEqual(policy, expectedPolicy)
}

const assertExactActionCount = (source, action, count) => {
  const pattern = new RegExp(
    `uses:\\s+${action.repository.replace("/", "\\/")}@${action.commit}\\s+#\\s+${action.version.replace(".", "\\.")}`,
    "gu"
  )
  assert.equal(source.match(pattern)?.length, count)
}

const extractWorkflowJob = (source, jobName) => {
  const lines = source.split(/\r?\n/u)
  const startPattern = new RegExp(`^  ${jobName}:\\s*$`, "u")
  const startIndexes = lines.flatMap((line, index) =>
    startPattern.test(line) ? [index] : []
  )
  assert.equal(
    startIndexes.length,
    1,
    `${jobName} job must appear exactly once`
  )
  const startIndex = startIndexes[0]
  const endIndex = lines.findIndex(
    (line, index) =>
      index > startIndex && /^  [a-z][a-z0-9_-]*:\s*$/u.test(line)
  )
  return lines
    .slice(startIndex, endIndex === -1 ? lines.length : endIndex)
    .join("\n")
}

const verifyDockerfile = (service, source, policy) => {
  assert.match(source, new RegExp(`^ARG NODE_IMAGE=${policy.nodeImage}$`, "mu"))
  assert.match(source, /^FROM \$\{NODE_IMAGE\}$/mu)
  assert.match(source, /^ARG REVISION$/mu)
  assert.match(source, /^USER node$/mu)
  assert.match(source, new RegExp(`^WORKDIR ${service.workdir}$`, "mu"))
  assert.match(source, new RegExp(`^EXPOSE ${service.port}$`, "mu"))
  assert.match(source, /org\.opencontainers\.image\.revision="\$\{REVISION\}"/u)
  assert.match(source, /ENV COMMIT_SHA="\$\{REVISION\}"/u)
  assert.match(source, /RUN rm -rf \/usr\/local\/lib\/node_modules\/npm/u)
  assert.match(source, /\/usr\/local\/bin\/npm/u)
  assert.match(source, /\/usr\/local\/bin\/npx/u)
  assert.doesNotMatch(
    source,
    /(?:apt-get|apk|curl|wget|npm\s+(?:ci|install)|pnpm\s+install|yarn\s+install)/u
  )
}

export const validateRuntimeWorkflowSource = (source) => {
  const policy = expectedPolicy
  const sourceLines = source.split(/\r?\n/u)
  const validateJob = extractWorkflowJob(source, "validate")
  const publishJob = extractWorkflowJob(source, "publish")

  assert.match(source, /branches: \[staging, master\]/u)
  assert.doesNotMatch(source, /PUBLISH_IMAGE/u)
  assert.match(
    validateJob,
    /if: \$\{\{ github\.ref != 'refs\/heads\/master' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.publish != true\) \}\}/u
  )
  assert.match(validateJob, /permissions:\n\s+contents: read/u)
  assert.doesNotMatch(
    validateJob,
    /(?:attestations|id-token|packages):\s+write/u
  )
  assert.doesNotMatch(validateJob, /docker\/login-action@/u)
  assert.doesNotMatch(validateJob, /actions\/attest@/u)
  assert.doesNotMatch(validateJob, /run:\s+docker push/u)

  assert.match(
    publishJob,
    /if: \$\{\{ github\.ref == 'refs\/heads\/master' && \(github\.event_name == 'push' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.publish == true\)\) \}\}/u
  )
  assert.match(
    publishJob,
    /permissions:\n\s+attestations: write\n\s+contents: read\n\s+id-token: write\n\s+packages: write/u
  )
  assert.equal(source.match(/run: pnpm run qa:runtime-images/gu)?.length, 2)
  assert.equal(source.match(/push: false/gu)?.length, 2)
  assert.equal(source.match(/load: true/gu)?.length, 2)
  assert.equal(
    source.match(/build-args: REVISION=\$\{\{ github\.sha \}\}/gu)?.length,
    2
  )
  for (const [name, value] of [
    ["ADMIN_CORS", "http://127.0.0.1:3000"],
    ["AUTH_CORS", "http://127.0.0.1:3000"],
    ["BACKEND_PUBLIC_URL", "http://127.0.0.1:9000"],
    ["COOKIE_SECRET", "ci-runtime-backend-cookie-20260902"],
    [
      "DATABASE_URL",
      "postgresql://postgres:postgres@127.0.0.1:5432/remorseless",
    ],
    ["JWT_SECRET", "ci-runtime-backend-jwt-20260902"],
    ["MEILISEARCH_ADMIN_KEY", "ci-runtime-admin-key-20260902"],
    ["STORE_CORS", "http://127.0.0.1:3000"],
  ]) {
    assert.equal(
      sourceLines.filter((line) => line === `  ${name}: ${value}`).length,
      1
    )
  }
  assert.equal(source.match(/build_node_environment: test/gu)?.length, 2)
  assert.equal(source.match(/build_node_environment: production/gu)?.length, 2)
  assert.equal(
    source.match(
      /build_command: pnpm --filter remorseless-records-storefront run build:runtime/gu
    )?.length,
    2
  )
  assert.equal(
    source.match(/NODE_ENV: \$\{\{ matrix\.build_node_environment \}\}/gu)
      ?.length,
    2
  )
  assert.doesNotMatch(source, /build-args:[^\n]*secrets\./u)
  for (const endpoint of [
    "fonts.googleapis.com:443",
    "fonts.gstatic.com:443",
    "production.cloudfront.docker.com:443",
  ]) {
    assert.equal(
      sourceLines.filter((line) => line.trim() === endpoint).length,
      2
    )
  }
  assert.equal(source.match(/ignore-unfixed: true/gu)?.length, 2)
  assert.equal(source.match(/severity: CRITICAL,HIGH/gu)?.length, 2)
  assert.equal(source.match(/exit-code: 1/gu)?.length, 2)
  assert.equal(source.match(/format: cyclonedx/gu)?.length, 2)
  assert.equal(
    source.match(
      /- name: Prepare private runtime image evidence directory\n\s+shell: bash\n\s+run: install -d -m 0700 artifacts/gu
    )?.length,
    2
  )
  assert.match(publishJob, /run: docker push "\$\{IMAGE_REF\}"/u)
  assert.match(
    publishJob,
    /docker buildx imagetools inspect --raw "\$\{IMAGE_REF\}"/u
  )
  const scanIndex = publishJob.indexOf(
    `uses: ${policy.trivy.repository}@${policy.trivy.commit}`
  )
  const loginIndex = publishJob.indexOf(
    `uses: ${policy.actions.login.repository}@${policy.actions.login.commit}`
  )
  const pushIndex = publishJob.indexOf('run: docker push "${IMAGE_REF}"')
  assert.ok(scanIndex >= 0 && scanIndex < loginIndex)
  assert.ok(loginIndex < pushIndex)
  assert.equal(source.match(/- name: Smoke exact runtime image/gu)?.length, 2)
  assert.doesNotMatch(source, /- name: Smoke exact runtime image\n\s+if:/u)
  assert.equal(source.match(/test -z "\$\(command -v npm\)"/gu)?.length, 2)
  assert.equal(source.match(/test -z "\$\(command -v npx\)"/gu)?.length, 2)
  for (const job of [validateJob, publishJob]) {
    const runtimeSmokeIndex = job.indexOf('test "$(id -u)" = 1000')
    const serviceBranchIndex = job.indexOf(
      'if [ "${{ matrix.service }}" = "backend" ]'
    )
    assert.ok(
      runtimeSmokeIndex >= 0 && runtimeSmokeIndex < serviceBranchIndex,
      "Common runtime identity smoke must execute before service branching."
    )
    const evidenceDirectoryIndex = job.indexOf(
      "run: install -d -m 0700 artifacts"
    )
    const sbomIndex = job.indexOf("format: cyclonedx")
    assert.ok(
      evidenceDirectoryIndex >= 0 && evidenceDirectoryIndex < sbomIndex,
      "The private evidence directory must exist before SBOM generation."
    )
  }
  for (const environmentName of [
    "CART_COOKIE_SECRET",
    "CHECKOUT_BFF_SECRET",
    "CHECKOUT_RECEIPT_SECRET",
    "MEDUSA_BACKEND_URL",
    "MEILISEARCH_HOST",
    "MEILISEARCH_SEARCH_KEY",
    "PUBLIC_FORM_BFF_SECRET",
  ]) {
    assert.equal(
      source.match(new RegExp(`-e ${environmentName}`, "gu"))?.length,
      2
    )
  }
  assert.equal(
    source.match(/--digest "\$\{\{ steps\.image\.outputs\.digest \}\}"/gu)
      ?.length,
    2
  )
  assert.match(
    publishJob,
    /image-ref: \$\{\{ matrix\.image_name \}\}@\$\{\{ steps\.image\.outputs\.digest \}\}/u
  )
  assert.match(
    publishJob,
    /sbom-path: artifacts\/\$\{\{ matrix\.service \}\}\.cdx\.json/u
  )
  assert.equal(source.match(/push-to-registry: true/gu)?.length, 2)
  assert.equal(source.match(/retention-days: 30/gu)?.length, 2)
  assert.equal(
    source.match(/TRIVY_DB_REPOSITORY: ghcr\.io\/aquasecurity\/trivy-db/gu)
      ?.length,
    4
  )
  assert.equal(source.match(/version: v0\.70\.0/gu)?.length, 4)

  assertExactActionCount(source, policy.actions.setupBuildx, 2)
  assertExactActionCount(source, policy.actions.login, 1)
  assertExactActionCount(source, policy.actions.buildPush, 2)
  assertExactActionCount(source, policy.actions.attest, 2)
  assertExactActionCount(source, policy.trivy, 4)
}

export const verifyRuntimeImagePolicy = () => {
  const policy = JSON.parse(readFileSync(policyPath, "utf8"))
  validateRuntimeImagePolicyManifest(policy)

  for (const service of Object.values(policy.services)) {
    verifyDockerfile(
      service,
      readFileSync(join(root, service.dockerfile), "utf8"),
      policy
    )
  }

  const backendDockerfile = readFileSync(
    join(root, policy.services.backend.dockerfile),
    "utf8"
  )
  assert.match(
    backendDockerfile,
    /COPY --chown=node:node backend\/\.medusa\/server\/ \.\//u
  )
  assert.match(backendDockerfile, /runtime-release-prepare\.mjs/u)
  assert.match(
    backendDockerfile,
    /CMD \["node", "--require", "\.\/observability-register\.cjs", "\.\/node_modules\/@medusajs\/cli\/cli\.js", "start", "--verbose"\]/u
  )

  const storefrontDockerfile = readFileSync(
    join(root, policy.services.storefront.dockerfile),
    "utf8"
  )
  assert.match(storefrontDockerfile, /storefront\/\.next\/standalone\//u)
  assert.match(storefrontDockerfile, /storefront\/\.next\/static\//u)
  assert.match(storefrontDockerfile, /storefront\/public\//u)
  assert.match(storefrontDockerfile, /CMD \["node", "server\.js"\]/u)

  const dockerignore = readFileSync(join(root, ".dockerignore"), "utf8")
  for (const boundary of [
    "**/.env",
    "**/.env.*",
    "**/node_modules",
    "!backend/.medusa/server/node_modules/**",
    "!storefront/.next/standalone/node_modules/**",
    "**/.git",
    ".railway",
    "Default",
  ]) {
    assert.match(
      dockerignore,
      new RegExp(
        `^${boundary.replaceAll("*", "\\*").replaceAll(".", "\\.")}$`,
        "mu"
      )
    )
  }

  const nextConfig = readFileSync(
    join(root, "storefront/next.config.ts"),
    "utf8"
  )
  assert.match(nextConfig, /process\.env\.STOREFRONT_BUILD_OUTPUT/u)
  assert.match(nextConfig, /storefrontBuildOutput !== undefined/u)
  assert.match(nextConfig, /output: "standalone"/u)
  assert.match(
    nextConfig,
    /outputFileTracingRoot: path\.resolve\(currentDir, "\.\."\)/u
  )
  assert.match(nextConfig, /\.\.\.buildOutputConfig/u)

  const storefrontPackageJson = JSON.parse(
    readFileSync(join(root, "storefront/package.json"), "utf8")
  )
  assert.equal(
    storefrontPackageJson.scripts?.["build:runtime"],
    "STOREFRONT_BUILD_OUTPUT=standalone pnpm run build"
  )

  validateRuntimeWorkflowSource(
    readFileSync(join(root, policy.workflow), "utf8")
  )

  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8")
  )
  assert.equal(
    packageJson.scripts?.["qa:runtime-images"],
    "node --test scripts/verify-runtime-image-policy.test.mjs && node scripts/verify-runtime-image-policy.mjs"
  )
  assert.match(
    packageJson.scripts?.["qa:lint"] ?? "",
    /pnpm run qa:runtime-images/u
  )

  console.info(
    "Runtime image policy verified: two digest-pinned nonroot images, clean scan/SBOM gates, and signed master artifacts."
  )
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (executedPath === fileURLToPath(import.meta.url)) {
  verifyRuntimeImagePolicy()
}
