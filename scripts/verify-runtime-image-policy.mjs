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
  schemaVersion: 3,
  nodeImage:
    "node:26.9.0-bookworm-slim@sha256:582460f614631b59b824ac6020533b9bf339c7fdf3a6d7db31abb6b4065f0212",
  nodeBinarySha256: {
    amd64: "05757b064ad2a221b41874794da42361c9bab033c7c33c1f1b458c25a7de7e59",
    arm64: "53a18c9a23bac8635ea9eb9cdef98e4b7bb77e0420cc966fb371a566ce22c763",
  },
  libatomicSha256: {
    amd64: "107ab9f7661a1c47cddfb5cd1def99ec537a50a9a537fbe38cdde1b34b8ba280",
    arm64: "c90c21008853899dfa102eeaa43b703c2bf41553dd56b13aac6da2803d5884b7",
  },
  runtimeBaseImage:
    "gcr.io/distroless/cc-debian13:nonroot@sha256:54df941ed0d06a1bd95ef5e0ce391fd8d9f94b64782dc9a60062727849ee3f97",
  repository: "https://github.com/traweezy/remorseless-records",
  trivy: {
    repository: "aquasecurity/setup-trivy",
    commit: "3fb12ec12f41e471780db15c232d5dd185dcb514",
    version: "v0.2.6",
    scannerVersion: "v0.70.0",
    binarySha256:
      "379d59f24a4a828c55de5f0b91b6805cc35d13580180b658820e648611256166",
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

const reviewedNodeVersion =
  /^node:(\d+\.\d+\.\d+)-bookworm-slim@sha256:[0-9a-f]{64}$/u.exec(
    expectedPolicy.nodeImage
  )?.[1]
assert.ok(
  reviewedNodeVersion,
  "Reviewed runtime image must identify an exact Node version"
)

export const validateNodeVersionPin = (source) => {
  assert.equal(
    source,
    `v${reviewedNodeVersion}\n`,
    "Railway and local Node pins must match the scanned runtime image"
  )
}

export const validateNodeEngine = (manifest) => {
  assert.equal(
    manifest.engines?.node,
    reviewedNodeVersion,
    "Workspace Node engines must match the scanned runtime image"
  )
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

const storefrontDecoderStep = (
  imageOutput
) => `      - name: Test packaged Storefront image decoders
        if: \${{ matrix.service == 'storefront' }}
        timeout-minutes: 2
        shell: bash
        run: |
          image_id="\${{ steps.${imageOutput}.outputs.digest }}"
          if [[ ! "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
            exit 1
          fi
          container_id="$(docker create --pull never \\
            --network none --read-only --cap-drop ALL \\
            --security-opt no-new-privileges \\
            --memory 256m --cpus 1 --pids-limit 64 \\
            --mount "type=bind,source=\${GITHUB_WORKSPACE}/storefront/scripts/image-optimizer.runtime.test.mjs,target=/app/storefront/image-optimizer.runtime.test.mjs,readonly" \\
            --entrypoint node "$image_id" \\
            --test --test-isolation=process --test-timeout=30000 \\
            /app/storefront/image-optimizer.runtime.test.mjs)"
          if [[ ! "$container_id" =~ ^[0-9a-f]{64}$ ]]; then
            exit 1
          fi
          cleanup() {
            timeout --signal=TERM --kill-after=5s 10s docker rm --force "$container_id" >/dev/null
          }
          trap cleanup EXIT
          timeout --signal=TERM --kill-after=10s 45s docker start --attach "$container_id"
          test "$(docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' "$container_id")" = 'exited 0'`

const localImageResolutionStep = (
  imageOutput
) => `      - name: Resolve local runtime image digest
        id: ${imageOutput}
        shell: bash
        run: |
          image_digest="$(docker image inspect --format '{{.Id}}' "\${IMAGE_REF}")"
          if [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
            exit 1
          fi
          echo "digest=\${image_digest}" >> "$GITHUB_OUTPUT"`

const requireExactStep = (job, expectedStep) => {
  const name = expectedStep.split("\n")[0]
  assert.equal(job.split("\n").filter((line) => line === name).length, 1)
  const start = job.indexOf(`${name}\n`)
  const end = job.indexOf("\n      - ", start + 1)
  assert.equal(
    job.slice(start, end === -1 ? job.length : end).trimEnd(),
    expectedStep,
    "Packaged Storefront decoder smoke must retain its exact identity, isolation, and failure boundaries."
  )
  return start
}

const runtimeIdentityAssertion = (policy) =>
  `const a=require("node:assert/strict"),c=require("node:crypto"),f=require("node:fs");a.equal(process.getuid(),1000);a.equal(process.version,"v26.9.0");const hashes={x64:"${policy.nodeBinarySha256.amd64}",arm64:"${policy.nodeBinarySha256.arm64}"},libs={x64:"${policy.libatomicSha256.amd64}",arm64:"${policy.libatomicSha256.arm64}"},sha=(p)=>c.createHash("sha256").update(f.readFileSync(p)).digest("hex");a.equal(sha("/usr/local/bin/node"),hashes[process.arch]);a.equal(sha("/usr/local/lib/libatomic.so.1"),libs[process.arch]);for(const p of ["/bin/sh","/usr/local/bin/npm","/usr/local/bin/npx"])a.equal(f.existsSync(p),false)`

const verifyStorefrontDecoderStep = (job, imageOutput) => {
  // Fail closed on duplicate/quoted job controls that could skip a protected
  // step while leaving its canonical text present elsewhere in the job.
  const jobKeys = job
    .split("\n")
    .filter((line) => /^    \S/u.test(line))
    .map((line) => /^    ([a-z-]+):(?:\s|$)/u.exec(line)?.[1])
  assert.deepEqual(jobKeys, [
    "name",
    "if",
    "runs-on",
    "timeout-minutes",
    "permissions",
    "strategy",
    "env",
    "steps",
  ])
  assert.deepEqual(
    [...job.matchAll(/^          - service: ([a-z]+)$/gmu)].map(
      (match) => match[1]
    ),
    ["backend", "storefront"]
  )

  const identity = requireExactStep(job, localImageResolutionStep(imageOutput))
  const start = requireExactStep(job, storefrontDecoderStep(imageOutput))
  const build = job.indexOf("      - name: Build immutable runtime image\n")
  const smoke = job.indexOf("      - name: Smoke exact runtime image\n")
  const scan = job.indexOf(
    "      - name: Scan runtime image for critical and high vulnerabilities\n"
  )
  assert.ok(
    build >= 0 &&
      build < identity &&
      identity < smoke &&
      smoke < start &&
      start < scan
  )
}

export const validateRuntimeDockerfileSource = (serviceName, source) => {
  const policy = expectedPolicy
  const service = policy.services[serviceName]
  assert.ok(service, "Unknown runtime image service.")
  const header = `ARG NODE_IMAGE=${policy.nodeImage}
ARG RUNTIME_BASE_IMAGE=${policy.runtimeBaseImage}

FROM \${NODE_IMAGE} AS node-runtime
ARG TARGETARCH
RUN set -eu; \\
    test "$(node --version)" = v26.9.0; \\
    case "$TARGETARCH" in \\
      amd64) triplet=x86_64-linux-gnu; node_sha256=${policy.nodeBinarySha256.amd64}; libatomic_sha256=${policy.libatomicSha256.amd64} ;; \\
      arm64) triplet=aarch64-linux-gnu; node_sha256=${policy.nodeBinarySha256.arm64}; libatomic_sha256=${policy.libatomicSha256.arm64} ;; \\
      *) exit 1 ;; \\
    esac; \\
    printf '%s  %s\\n' "$node_sha256" /usr/local/bin/node | sha256sum --check --status; \\
    cp -L "/usr/lib/$triplet/libatomic.so.1" /libatomic.so.1; \\
    test -s /libatomic.so.1; \\
    printf '%s  %s\\n' "$libatomic_sha256" /libatomic.so.1 | sha256sum --check --status

FROM \${RUNTIME_BASE_IMAGE}

ARG REVISION
LABEL org.opencontainers.image.description="Remorseless Records ${serviceName === "backend" ? "Medusa backend" : "Next.js storefront"}"
LABEL org.opencontainers.image.revision="\${REVISION}"
LABEL org.opencontainers.image.source="${policy.repository}"

`
  const common = `COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /libatomic.so.1 /usr/local/lib/libatomic.so.1
COPY --from=node-runtime /etc/passwd /etc/passwd
COPY --from=node-runtime /etc/group /etc/group
COPY --from=node-runtime --chown=1000:1000 /home/node/ /home/node/

WORKDIR ${service.workdir}

`
  const body =
    serviceName === "backend"
      ? `ENV COMMIT_SHA="\${REVISION}" \\
    HOME=/home/node \\
    LD_LIBRARY_PATH=/usr/local/lib \\
    NODE_ENV=production \\
    PATH=/usr/local/bin:/usr/bin:/bin

${common}COPY --chown=1000:1000 backend/.medusa/server/ ./
COPY --chown=1000:1000 backend/scripts/runtime-release-prepare.mjs ./scripts/runtime-release-prepare.mjs
COPY --chown=1000:1000 backend/scripts/lib/release-prepare.mjs ./scripts/lib/release-prepare.mjs

USER 1000:1000

EXPOSE 9000

ENTRYPOINT ["/usr/local/bin/node"]
CMD ["--require", "./observability-register.cjs", "./node_modules/@medusajs/cli/cli.js", "start", "--verbose"]
`
      : `ENV COMMIT_SHA="\${REVISION}" \\
    HOME=/home/node \\
    HOSTNAME=0.0.0.0 \\
    LD_LIBRARY_PATH=/usr/local/lib \\
    NEXT_TELEMETRY_DISABLED=1 \\
    NODE_ENV=production \\
    PATH=/usr/local/bin:/usr/bin:/bin \\
    PORT=3000

${common}COPY --chown=1000:1000 storefront/.next/standalone/ /app/
COPY --chown=1000:1000 storefront/.next/static/ ./.next/static/
COPY --chown=1000:1000 storefront/public/ ./public/

USER 1000:1000

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/node"]
CMD ["server.js"]
`
  assert.equal(source, header + body)
}

export const validateRuntimeWorkflowSource = (source) => {
  const policy = expectedPolicy
  const sourceLines = source.split(/\r?\n/u)
  const validateJob = extractWorkflowJob(source, "validate")
  const publishJob = extractWorkflowJob(source, "publish")
  verifyStorefrontDecoderStep(validateJob, "image")
  verifyStorefrontDecoderStep(publishJob, "local_image")

  assert.match(source, /branches: \[staging, master\]/u)
  assert.equal(source.match(/^  pull_request:$/gmu)?.length, 1)
  assert.match(source, /^  pull_request:\n    branches: \[staging, master\]$/mu)
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
    "get.trivy.dev:443",
    "production.cloudfront.docker.com:443",
    "security.debian.org:443",
  ]) {
    assert.equal(
      sourceLines.filter((line) => line.trim() === endpoint).length,
      2
    )
  }
  for (const [job, imageOutput] of [
    [validateJob, "image"],
    [publishJob, "local_image"],
  ]) {
    const setup = requireExactStep(
      job,
      `      - name: Setup reviewed runtime scanner
        uses: ${policy.trivy.repository}@${policy.trivy.commit} # ${policy.trivy.version}
        with:
          version: ${policy.trivy.scannerVersion}
          cache: false`
    )
    const scan = requireExactStep(
      job,
      `      - name: Scan runtime image for critical and high vulnerabilities
        timeout-minutes: 16
        shell: bash
        run: |
          node scripts/scan-runtime-image.mjs \\
            --service "\${{ matrix.service }}" \\
            --revision "\${GITHUB_SHA}" \\
            --image-id "\${{ steps.${imageOutput}.outputs.digest }}" \\
            --output artifacts`
    )
    assert.ok(setup < scan)
    requireExactStep(
      job,
      `      - name: Retain runtime image evidence
        if: \${{ always() }}
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: runtime-image-\${{ matrix.service }}-\${{ github.sha }}
          path: |
            artifacts/*.image.json
            artifacts/*.vuln.json
            artifacts/*.cdx.json
            artifacts/*.db.json
            artifacts/*.manifest.json
            artifacts/*.descriptor.json
            artifacts/failure.json
            artifacts/publication-failure.json
          if-no-files-found: error
          retention-days: 30`
    )
  }
  const pushIndex = requireExactStep(
    publishJob,
    `      - name: Push exact runtime image
        timeout-minutes: 10
        shell: bash
        run: |
          node scripts/verify-runtime-image-artifacts.mjs --require-current "artifacts/\${{ matrix.service }}.image.json"
          test "$(docker image inspect --format '{{.Id}}' "\${IMAGE_REF}")" = "\${{ steps.local_image.outputs.digest }}"
          docker push "\${IMAGE_REF}"`
  )
  const publication = requireExactStep(
    publishJob,
    `      - name: Resolve published runtime image digest
        id: image
        timeout-minutes: 3
        shell: bash
        run: |
          node scripts/finalize-runtime-image-publication.mjs \\
            "artifacts/\${{ matrix.service }}.image.json" >> "$GITHUB_OUTPUT"`
  )
  const scanIndex = publishJob.indexOf(
    "      - name: Scan runtime image for critical and high vulnerabilities"
  )
  const loginIndex = publishJob.indexOf(
    `uses: ${policy.actions.login.repository}@${policy.actions.login.commit}`
  )
  assert.ok(
    scanIndex >= 0 &&
      scanIndex < loginIndex &&
      loginIndex < pushIndex &&
      pushIndex < publication
  )
  assert.ok(
    publication <
      publishJob.indexOf("      - name: Attest runtime image provenance")
  )
  assert.doesNotMatch(
    source,
    /trivy-action@|write-runtime-image-record\.mjs|TRIVY_/u
  )
  assert.equal(source.match(/- name: Smoke exact runtime image/gu)?.length, 2)
  assert.doesNotMatch(source, /- name: Smoke exact runtime image\n\s+if:/u)
  assert.equal(
    source.match(
      /docker run --rm --entrypoint \/usr\/local\/bin\/node "\$\{IMAGE_REF\}" -e/gu
    )?.length,
    4
  )
  assert.equal(
    source.match(/a\.equal\(process\.getuid\(\),1000\)/gu)?.length,
    2
  )
  assert.equal(
    sourceLines.filter(
      (line) => line === `            '${runtimeIdentityAssertion(policy)}'`
    ).length,
    2,
    "Both image jobs must run the exact reviewed Node version and binary hash assertion."
  )
  assert.equal(
    source.match(
      /"\.\/node_modules\/@medusajs\/cli\/cli\.js","\.\/scripts\/runtime-release-prepare\.mjs"/gu
    )?.length,
    2
  )
  for (const job of [validateJob, publishJob]) {
    const runtimeSmokeIndex = job.indexOf("a.equal(process.getuid(),1000)")
    const serviceBranchIndex = job.indexOf(
      'if [ "${{ matrix.service }}" = "backend" ]'
    )
    assert.ok(
      runtimeSmokeIndex >= 0 && runtimeSmokeIndex < serviceBranchIndex,
      "Common runtime identity smoke must execute before service branching."
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
  assert.match(
    publishJob,
    /sbom-path: artifacts\/\$\{\{ matrix\.service \}\}\.cdx\.json/u
  )
  assert.equal(source.match(/push-to-registry: true/gu)?.length, 2)
  assert.equal(source.match(/retention-days: 30/gu)?.length, 2)
  assertExactActionCount(source, policy.actions.setupBuildx, 2)
  assertExactActionCount(source, policy.actions.login, 1)
  assertExactActionCount(source, policy.actions.buildPush, 2)
  assertExactActionCount(source, policy.actions.attest, 2)
  assertExactActionCount(source, policy.trivy, 2)
}

export const verifyRuntimeImagePolicy = () => {
  const policy = JSON.parse(readFileSync(policyPath, "utf8"))
  validateRuntimeImagePolicyManifest(policy)

  for (const versionFile of [".nvmrc", "backend/.nvmrc", "storefront/.nvmrc"]) {
    validateNodeVersionPin(readFileSync(join(root, versionFile), "utf8"))
  }
  for (const manifestFile of [
    "package.json",
    "backend/package.json",
    "storefront/package.json",
  ]) {
    validateNodeEngine(
      JSON.parse(readFileSync(join(root, manifestFile), "utf8"))
    )
  }

  for (const [serviceName, service] of Object.entries(policy.services)) {
    validateRuntimeDockerfileSource(
      serviceName,
      readFileSync(join(root, service.dockerfile), "utf8")
    )
  }

  const backendDockerfile = readFileSync(
    join(root, policy.services.backend.dockerfile),
    "utf8"
  )
  assert.match(
    backendDockerfile,
    /COPY --chown=1000:1000 backend\/\.medusa\/server\/ \.\//u
  )
  assert.match(backendDockerfile, /runtime-release-prepare\.mjs/u)
  assert.match(
    backendDockerfile,
    /CMD \["--require", "\.\/observability-register\.cjs", "\.\/node_modules\/@medusajs\/cli\/cli\.js", "start", "--verbose"\]/u
  )

  const storefrontDockerfile = readFileSync(
    join(root, policy.services.storefront.dockerfile),
    "utf8"
  )
  assert.match(storefrontDockerfile, /storefront\/\.next\/standalone\//u)
  assert.match(storefrontDockerfile, /storefront\/\.next\/static\//u)
  assert.match(storefrontDockerfile, /storefront\/public\//u)
  assert.match(storefrontDockerfile, /CMD \["server\.js"\]/u)

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
    "node --test scripts/verify-runtime-image-policy.test.mjs scripts/runtime-image-evidence.test.mjs scripts/lib/trivy-db-diagnostic.test.mjs && node scripts/verify-runtime-image-policy.mjs"
  )
  assert.match(
    packageJson.scripts?.["qa:lint"] ?? "",
    /pnpm run qa:runtime-images/u
  )

  console.info(
    "Runtime image policy verified: digest-pinned Node and distroless runtime images, isolated packaged Storefront decoder gates, clean scan/SBOM gates, and signed master artifacts."
  )
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (executedPath === fileURLToPath(import.meta.url)) {
  verifyRuntimeImagePolicy()
}
