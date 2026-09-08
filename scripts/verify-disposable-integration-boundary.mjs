import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFile(join(repositoryRoot, path), "utf8")

const significant = (source) =>
  source
    .split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
export const validateHardenedFixtureWiring = ({
  backendWorkflow,
  compose,
  postgresDockerfile,
  redisDockerfile,
}) => {
  const pins = [
    [
      postgresDockerfile,
      "postgres:18.6-alpine3.24@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2",
    ],
    [
      redisDockerfile,
      "redis:8.10.1-alpine3.23@sha256:becdda6c7f4b3fb42e42fd7f120bbf5c54c4caaaf16f26da24e4563d2c1f0576",
    ],
  ]
  for (const [recipe, pin] of pins) {
    const databaseName = pin.slice(0, pin.indexOf(":"))
    const databaseStages = significant(recipe).filter((line) =>
      line.startsWith(`FROM ${databaseName}:`)
    )
    assert.ok(
      databaseStages.length > 0,
      "Fixture recipe must execute its pinned database base"
    )
    assert.ok(
      databaseStages.every(
        (line) => line === `FROM ${pin}` || line.startsWith(`FROM ${pin} AS `)
      ),
      "All database stages must use the pinned base"
    )
    assert.doesNotMatch(
      recipe,
      /--allow-untrusted|--no-check-certificate|--insecure/u
    )
  }
  for (const packagePin of [
    "libcrypto3=3.5.8-r0",
    "libssl3=3.5.8-r0",
    "setpriv=2.41.6-r1",
  ])
    assert.ok(
      significant(redisDockerfile).some(
        (line) => line.trim().replace(/\s+\\$/u, "") === packagePin
      ),
      `Redis security package pin lost: ${packagePin}`
    )
  const postgresLines = significant(postgresDockerfile).map((line) =>
    line.trim()
  )
  for (const instruction of [
    "ADD --checksum=sha256:63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445 https://go.dev/dl/go1.27.1.linux-amd64.tar.gz /tmp/go.tar.gz",
    "ADD --checksum=sha256:3450b45a3f9ee8568792736a5c5e70a1f2e9b36c35a8f74958c03e51d7d92bec https://go.dev/dl/go1.27.1.linux-arm64.tar.gz /tmp/go.tar.gz",
    "ADD --checksum=sha256:33d7537d588ea49458b9509bcf4554bdf5ceacc66da71e5caa1058ea3b689c3b https://codeload.github.com/tianon/gosu/tar.gz/6456aaa0f3c854d199d0f037f068eb97515b7513 /tmp/gosu.tar.gz",
    "&& echo '0475f1708db81d718b633faf2d9dd64695037eabdc8562125060607bcb01b2ba  go.mod' | sha256sum -c - \\",
    "&& echo '2a8f3fb6adb84839bbb9999f12f1416fb86c184135aaa1c2e489b35203c08346  go.sum' | sha256sum -c - \\",
    "&& /opt/go/bin/go mod edit -go=1.25.0 -require=golang.org/x/sys@v0.44.0 \\",
    "&& echo 'c29d3a92f3cae2a45faab57ad6656fb54e8d77cd26248b3f859dcef6bbcc6e2a  go.mod' | sha256sum -c - \\",
    "&& echo 'a5ea1f3ca7128f3e5bd53f2601ac6fd70f2cd6c68bf7627aa09655ce9bcc1758  go.sum' | sha256sum -c - \\",
    "&& /opt/go/bin/go mod verify \\",
    "&& /opt/go/bin/go build -trimpath -buildvcs=false -o /out/gosu . \\",
    "add libcrypto3=3.5.8-r0 libssl3=3.5.8-r0 libuuid=2.42.3-r1 libcurl=8.22.0-r0 \\",
    "COPY --from=gosu-build --chmod=755 /out/gosu /usr/local/bin/gosu",
    "COPY --from=gosu-build /out/licenses/gosu /usr/local/share/licenses/gosu",
  ])
    assert.ok(
      postgresLines.includes(instruction),
      `PostgreSQL security instruction lost: ${instruction}`
    )
  for (const setting of [
    "ENV CGO_ENABLED=0 \\",
    "GOTOOLCHAIN=local \\",
    "GOPROXY=https://proxy.golang.org \\",
    "GOSUMDB=sum.golang.org \\",
    "GOFLAGS=-mod=readonly",
  ])
    assert.ok(
      postgresLines.includes(setting),
      `PostgreSQL reproducibility setting lost: ${setting}`
    )
  const finalStage = postgresLines.slice(
    postgresLines.findLastIndex((line) => line.startsWith("FROM "))
  )
  assert.equal(
    finalStage.some((line) => /^(?:ENTRYPOINT|CMD|USER|ENV) /u.test(line)),
    false,
    "Official PostgreSQL runtime configuration must remain inherited"
  )
  const composeLines = significant(compose)
  assert.deepEqual(
    composeLines.filter((line) => /^    image:/u.test(line)),
    [
      "    image: remorseless-records-integration-postgres:18.6-hardened",
      "    image: remorseless-records-integration-redis:8.10.1-hardened",
    ]
  )
  assert.equal(composeLines.filter((line) => line === "    build:").length, 2)
  assert.equal(
    composeLines.filter(
      (line) => line === "      context: ./docker/integration"
    ).length,
    2
  )
  assert.deepEqual(
    composeLines.filter((line) => /^      dockerfile:/u.test(line)),
    [
      "      dockerfile: postgres.Dockerfile",
      "      dockerfile: redis.Dockerfile",
    ]
  )
  assert.equal(
    composeLines.filter((line) => line === "    pull_policy: never").length,
    2
  )
  assert.equal(composeLines.filter((line) => line === "    tmpfs:").length, 2)
  for (const path of ["      - /var/lib/postgresql", "      - /data"])
    assert.ok(composeLines.includes(path))
  assert.deepEqual(
    composeLines.filter((line) => /:5432"|:6379"/u.test(line)),
    [
      '      - "127.0.0.1:${RR_INTEGRATION_POSTGRES_PORT:-55432}:5432"',
      '      - "127.0.0.1:${RR_INTEGRATION_REDIS_PORT:-56379}:6379"',
    ],
    "Only reviewed loopback bindings may expose fixture ports"
  )
  assert.deepEqual(composeLines.slice(-3), [
    "networks:",
    "  default:",
    "    driver: bridge",
  ])
  assert.equal(
    composeLines.some((line) =>
      /^\s*volumes:|^\s*network_mode:|^\s*privileged:/u.test(line)
    ),
    false
  )
  const lines = backendWorkflow.split(/\r?\n/u)
  const starts = lines.flatMap((line, index) =>
    line === "  integration:" ? [index] : []
  )
  assert.equal(
    starts.length,
    1,
    "Backend must have exactly one disposable integration job"
  )
  const start = starts[0]
  const end = lines.findIndex(
    (line, index) =>
      index > start && /^  \S/u.test(line) && !line.trimStart().startsWith("#")
  )
  const job = significant(
    lines.slice(start + 1, end < 0 ? undefined : end).join("\n")
  )
  const stepsIndex = job.indexOf("    steps:")
  assert.ok(stepsIndex > 0)
  assert.deepEqual(
    job.slice(0, stepsIndex),
    [
      "    name: Disposable PostgreSQL & Redis Integration",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 40",
      "    needs: [lint, typecheck, secrets]",
      "    permissions:",
      "      contents: read",
      "    env:",
      '      STRIPE_API_KEY: ""',
      '      STRIPE_LIFECYCLE_WEBHOOK_SECRET: ""',
      '      STRIPE_PAYMENT_METHOD_CONFIGURATION: ""',
      '      STRIPE_WEBHOOK_SECRET: ""',
    ],
    "Integration job must not bypass fixtures with services, conditions or inherited shell controls"
  )
  const steps = []
  for (const line of job.slice(stepsIndex + 1)) {
    if (/^      - /u.test(line)) steps.push([line])
    else {
      assert.ok(
        steps.length > 0 && /^        /u.test(line),
        "Unreviewed integration step layout"
      )
      steps.at(-1).push(line)
    }
  }
  const exactStep = (name, body) => {
    const indices = steps.flatMap((step, index) =>
      step[0] === `      - name: ${name}` ? [index] : []
    )
    assert.equal(
      indices.length,
      1,
      `Required integration step lost or duplicated: ${name}`
    )
    assert.deepEqual(
      steps[indices[0]].slice(1),
      body,
      `Integration gate must not have bypass controls: ${name}`
    )
    return indices[0]
  }
  const order = [
    exactStep("Build hardened disposable integration images", [
      "        run: docker compose --env-file /dev/null --file compose.integration.yml build",
    ]),
    exactStep("Setup Trivy", [
      "        uses: aquasecurity/setup-trivy@3fb12ec12f41e471780db15c232d5dd185dcb514 # v0.2.6",
      "        with:",
      "          version: v0.70.0",
      "          cache: false",
    ]),
    exactStep("Scan exact disposable integration images", [
      "        env:",
      "          TRIVY_DB_REPOSITORY: ghcr.io/aquasecurity/trivy-db",
      "        run: node scripts/scan-disposable-integration-images.mjs --output artifacts/disposable-integration",
    ]),
    exactStep("Run disposable integration and API contracts", [
      "        run: pnpm run qa:disposable-integration --no-build",
    ]),
  ]
  assert.ok(
    order.every((value, index) => index === 0 || value > order[index - 1]),
    "Build, scan and no-build runtime must retain their order"
  )
  assert.doesNotMatch(
    job.join("\n"),
    /(?:^|\s)[&*][a-zA-Z_][a-zA-Z0-9_-]*|^\s*<<:/mu
  )
  return { event: "disposable.integration.wiring_verified", imageCount: 2 }
}

export const verifyDisposableIntegrationBoundary = async () => {
  const [
    backendWorkflow,
    compose,
    integrationTest,
    orchestrator,
    packageSource,
  ] = await Promise.all([
    read(".github/workflows/backend.yml"),
    read("compose.integration.yml"),
    read("backend/integration-tests/disposable-infrastructure.test.ts"),
    read("scripts/run-disposable-integration.mjs"),
    read("package.json"),
  ])

  validateHardenedFixtureWiring({
    backendWorkflow,
    compose,
    postgresDockerfile: await read("docker/integration/postgres.Dockerfile"),
    redisDockerfile: await read("docker/integration/redis.Dockerfile"),
  })
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
    "run: pnpm run qa:disposable-integration --no-build",
    "needs: [unit, integration]",
    'STRIPE_API_KEY: ""',
    'STRIPE_LIFECYCLE_WEBHOOK_SECRET: ""',
    'STRIPE_PAYMENT_METHOD_CONFIGURATION: ""',
    'STRIPE_WEBHOOK_SECRET: ""',
  ]) {
    assert.ok(
      backendWorkflow.includes(marker),
      `Backend CI gate lost: ${marker}`
    )
  }
  for (const marker of [
    "127.0.0.1:${RR_INTEGRATION_POSTGRES_PORT:-55432}:5432",
    "127.0.0.1:${RR_INTEGRATION_REDIS_PORT:-56379}:6379",
  ]) {
    assert.ok(compose.includes(marker), `Loopback binding lost: ${marker}`)
  }
  for (const marker of [
    'signals.on("SIGINT", handleInterrupt)',
    'signals.on("SIGTERM", handleTermination)',
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
    "pnpm --filter backend run test:integration && pnpm run qa:postgres-recovery:integration && pnpm run qa:redis-capacity:integration && pnpm run qa:api-contract && node --test scripts/medusa-session-rotation.integration.test.mjs"
  )
  assert.equal(
    packageManifest.scripts?.["qa:redis-capacity:integration"],
    "node --test scripts/redis-capacity-audit.integration.test.mjs"
  )
  assert.ok(
    packageManifest.scripts?.["qa:database-release-boundary"]?.includes(
      "pnpm run qa:redis-capacity"
    ),
    "Redis capacity unit/CLI coverage gate lost"
  )
  for (const marker of [
    "--test-coverage-lines=80",
    "--test-coverage-branches=80",
    "--test-coverage-functions=80",
    "scripts/cli-arguments.test.mjs",
    "scripts/redis-capacity-audit.test.mjs",
    "scripts/redis-audit-client.test.mjs",
    "scripts/redis-audit-cli.test.mjs",
  ])
    assert.ok(
      packageManifest.scripts?.["qa:redis-capacity"]?.includes(marker),
      `Redis audit coverage requirement lost: ${marker}`
    )
  const redisAuditTest = await read(
    "scripts/redis-capacity-audit.integration.test.mjs"
  )
  for (const marker of [
    'environment.INTEGRATION_TESTS_ENABLED !== "1"',
    "const allowedCommands = new Set(expectedCommands.map(JSON.stringify))",
    "if (!allowedCommands.has(JSON.stringify(command)))",
    'assert.ok(report.reasons.includes("aof_disabled"))',
  ])
    assert.ok(
      redisAuditTest.includes(marker),
      `Redis read-only fixture guard lost: ${marker}`
    )
  assert.equal(
    packageManifest.scripts?.["qa:postgres-recovery:integration"],
    "node --test scripts/postgres-recovery.integration.test.mjs"
  )
  const recoveryTest = await read(
    "scripts/postgres-recovery.integration.test.mjs"
  )
  for (const marker of [
    'process.env.INTEGRATION_TESTS_ENABLED !== "1"',
    'url.password !== "local_integration_only"',
    'url.pathname !== "/postgres"',
    "url.search ||",
    "url.hash",
    "DROP DATABASE",
    "ROLLBACK",
  ]) {
    assert.ok(
      recoveryTest.includes(marker),
      `Recovery fixture guard lost: ${marker}`
    )
  }
  const localCommands =
    packageManifest.scripts?.["qa:lint"]?.split(" && ") ?? []
  for (const command of [
    "pnpm run qa:ci-shared-contracts-boundary",
    "pnpm run qa:ci-shared-contracts",
  ])
    assert.equal(localCommands.filter((entry) => entry === command).length, 1)
  assert.equal(
    packageManifest.scripts?.["qa:ci-shared-contracts"]
      ?.split(" && ")
      .filter(
        (entry) => entry === "pnpm run qa:disposable-integration-boundary"
      ).length,
    1
  )
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await verifyDisposableIntegrationBoundary()
