import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  validateHardenedFixtureWiring,
  verifyDisposableIntegrationBoundary,
} from "./verify-disposable-integration-boundary.mjs"

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const sources = () => ({
  backendWorkflow: read(".github/workflows/backend.yml"),
  compose: read("compose.integration.yml"),
  postgresDockerfile: read("docker/integration/postgres.Dockerfile"),
  redisDockerfile: read("docker/integration/redis.Dockerfile"),
})
const mutate = (key, from, to) => {
  const fixture = sources()
  assert.ok(
    fixture[key].includes(from),
    "Mutation must match the current reviewed source"
  )
  fixture[key] = fixture[key].replace(from, to)
  return fixture
}

test("accepts reviewed build, scan, immutable-start and isolated-fixture wiring", () => {
  assert.deepEqual(validateHardenedFixtureWiring(sources()), {
    event: "disposable.integration.wiring_verified",
    imageCount: 2,
  })
})

test("retains full service, recovery, audit, API and root-contract assertions", async () => {
  await verifyDisposableIntegrationBoundary()
})

for (const [name, command] of [
  [
    "build",
    "docker compose --env-file /dev/null --file compose.integration.yml build",
  ],
  [
    "scan",
    "node scripts/scan-disposable-integration-images.mjs --output artifacts/disposable-integration",
  ],
  ["runtime", "pnpm run qa:disposable-integration --no-build"],
])
  test(`rejects skipped, comment-only, folded or error-suppressed ${name} step`, () => {
    const from = `        run: ${command}`
    for (const to of [
      `        # run: ${command}`,
      "        run: true",
      `        run: |\n          ${command}`,
      `${from} || true`,
      `        if: false\n${from}`,
      `        continue-on-error: true\n${from}`,
      `        shell: bash -c 'true' {0}\n${from}`,
    ])
      assert.throws(() =>
        validateHardenedFixtureWiring(mutate("backendWorkflow", from, to))
      )
  })

test("rejects scanner setup version drift or bypass", () => {
  for (const [from, to] of [
    ["          version: v0.70.0", "          version: latest"],
    [
      "      - name: Setup Trivy",
      "      - name: Setup Trivy\n        if: false",
    ],
  ])
    assert.throws(() =>
      validateHardenedFixtureWiring(mutate("backendWorkflow", from, to))
    )
})

test("rejects conditional integration jobs and old external service blocks", () => {
  for (const line of [
    "    if: false",
    "    continue-on-error: true",
    "    services:\n      redis:\n        image: redis:latest",
    "    defaults:\n      run:\n        shell: bash -c 'true' {0}",
  ])
    assert.throws(() =>
      validateHardenedFixtureWiring(
        mutate(
          "backendWorkflow",
          "  integration:\n",
          `  integration:\n${line}\n`
        )
      )
    )
})

test("rejects duplicate required steps or integration jobs", () => {
  assert.throws(() =>
    validateHardenedFixtureWiring(
      mutate(
        "backendWorkflow",
        "      - name: Build hardened disposable integration images",
        "      - name: Build hardened disposable integration images\n        run: docker compose --file compose.integration.yml build\n      - name: Build hardened disposable integration images"
      )
    )
  )
  const fixture = sources()
  fixture.backendWorkflow += "\n  integration:\n    steps: []\n"
  assert.throws(() => validateHardenedFixtureWiring(fixture))
})

test("rejects runtime occurring before scanning", () => {
  const fixture = sources()
  const step =
    "      - name: Run disposable integration and API contracts\n        run: pnpm run qa:disposable-integration --no-build\n"
  assert.ok(fixture.backendWorkflow.includes(step))
  fixture.backendWorkflow = fixture.backendWorkflow
    .replace(step, "")
    .replace(
      "      - name: Scan exact disposable integration images",
      `${step}\n      - name: Scan exact disposable integration images`
    )
  assert.throws(() => validateHardenedFixtureWiring(fixture), /order/u)
})

for (const key of ["postgresDockerfile", "redisDockerfile"])
  test(`rejects comment-only or floating database base in ${key}`, () => {
    const fixture = sources()
    const database = key === "postgresDockerfile" ? "postgres" : "redis"
    const lines = fixture[key].split("\n")
    for (const change of ["comment", "floating"]) {
      const changed = {
        ...fixture,
        [key]: lines
          .map((line) =>
            line.startsWith(`FROM ${database}:`)
              ? change === "comment"
                ? `# ${line}`
                : `FROM ${database}:latest`
              : line
          )
          .join("\n"),
      }
      assert.throws(() => validateHardenedFixtureWiring(changed))
    }
  })

test("rejects Redis security package pin removal and trust bypass", () => {
  assert.throws(() =>
    validateHardenedFixtureWiring(
      mutate("redisDockerfile", "libssl3=3.5.8-r0", "libssl3")
    )
  )
  assert.throws(() =>
    validateHardenedFixtureWiring(
      mutate(
        "redisDockerfile",
        "RUN apk --no-cache",
        "RUN apk --no-cache --allow-untrusted"
      )
    )
  )
})

test("rejects PostgreSQL package, source, toolchain or module-integrity pin removal", () => {
  for (const pin of [
    "libcrypto3=3.5.8-r0",
    "libssl3=3.5.8-r0",
    "libuuid=2.42.3-r1",
    "libcurl=8.22.0-r0",
    "go1.27.1.linux-amd64.tar.gz",
    "go1.27.1.linux-arm64.tar.gz",
    "33d7537d588ea49458b9509bcf4554bdf5ceacc66da71e5caa1058ea3b689c3b",
    "6456aaa0f3c854d199d0f037f068eb97515b7513",
    "0475f1708db81d718b633faf2d9dd64695037eabdc8562125060607bcb01b2ba",
    "2a8f3fb6adb84839bbb9999f12f1416fb86c184135aaa1c2e489b35203c08346",
    "c29d3a92f3cae2a45faab57ad6656fb54e8d77cd26248b3f859dcef6bbcc6e2a",
    "a5ea1f3ca7128f3e5bd53f2601ac6fd70f2cd6c68bf7627aa09655ce9bcc1758",
    "golang.org/x/sys@v0.44.0",
    "GOSUMDB=sum.golang.org",
    "GOFLAGS=-mod=readonly",
    "COPY --from=gosu-build --chmod=755 /out/gosu /usr/local/bin/gosu",
    "COPY --from=gosu-build /out/licenses/gosu /usr/local/share/licenses/gosu",
  ])
    assert.throws(() =>
      validateHardenedFixtureWiring(
        mutate("postgresDockerfile", pin, "removed_security_pin")
      )
    )
})

test("rejects comment-only PostgreSQL checksums and runtime privilege overrides", () => {
  const fixture = sources()
  fixture.postgresDockerfile = fixture.postgresDockerfile.replace(
    /^ADD --checksum=/mu,
    "# ADD --checksum="
  )
  assert.throws(() => validateHardenedFixtureWiring(fixture))
  const override = sources()
  override.postgresDockerfile += "\nUSER root\n"
  assert.throws(
    () => validateHardenedFixtureWiring(override),
    /runtime configuration/u
  )
})

test("rejects external fallback images or repository-wide build context", () => {
  for (const [from, to] of [
    [
      "image: remorseless-records-integration-redis:8.10.1-hardened",
      "image: redis:latest",
    ],
    ["context: ./docker/integration", "context: ."],
    ["pull_policy: never", "pull_policy: missing"],
    ["dockerfile: redis.Dockerfile", "dockerfile: unreviewed.Dockerfile"],
  ])
    assert.throws(() =>
      validateHardenedFixtureWiring(mutate("compose", from, to))
    )
})

test("rejects persistent data, incompatible networks and public port bindings", () => {
  for (const [from, to] of [
    ["    tmpfs:", "    volumes:"],
    ["      - /data", "      - /private/data:/data"],
    ["    driver: bridge", "    internal: true"],
    [
      "127.0.0.1:${RR_INTEGRATION_POSTGRES_PORT:-55432}:5432",
      "0.0.0.0:${RR_INTEGRATION_POSTGRES_PORT:-55432}:5432",
    ],
  ])
    assert.throws(() =>
      validateHardenedFixtureWiring(mutate("compose", from, to))
    )
})
