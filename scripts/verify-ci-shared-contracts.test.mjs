import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { validateCiSharedContracts } from "./verify-ci-shared-contracts.mjs"

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const manifest = JSON.parse(read("package.json"))
const workflow = read(".github/workflows/root.yml")
const aggregate = "qa:ci-shared-contracts"
const boundary = "qa:ci-shared-contracts-boundary"
const toolchain = "qa:toolchain-runtime"
const posthog = "qa:posthog-runtime"
const names = [
  "qa:service-container-resolution",
  "qa:storefront-response-boundary",
  "qa:admin-browser-boundary",
  "qa:database-release-boundary",
  "qa:storefront-provider-fixture",
  "qa:dashboard-product-create",
  "qa:workflow-scheduler-timestamps",
  "qa:disposable-integration-boundary",
  "qa:operations-observation",
  "qa:observability-bootstrap",
]
const validate = (packageManifest = manifest, rootWorkflow = workflow) =>
  validateCiSharedContracts({ packageManifest, rootWorkflow })
const mutateScripts = (mutate) => {
  const changed = structuredClone(manifest)
  mutate(changed.scripts)
  return changed
}
const replaceWorkflow = (from, to) => {
  assert.ok(
    workflow.includes(from),
    "Mutation fixture must match the current workflow"
  )
  const changed = workflow.replace(from, to)
  assert.notEqual(changed, workflow)
  return changed
}
const removeCommand = (source, command) =>
  source
    .split(" && ")
    .filter((entry) => entry !== command)
    .join(" && ")

test("accepts ten shared contracts and reports unit-fixture rather than service integration coverage", () => {
  assert.deepEqual(
    manifest.scripts[aggregate].split(" && "),
    names.map((name) => `pnpm run ${name}`)
  )
  assert.deepEqual(validate(), {
    event: "ci.shared_contracts.verified",
    contractCount: 10,
    serviceIntegration: false,
  })
  for (const forbidden of [
    "qa:disposable-integration:services",
    "qa:postgres-recovery:integration",
    "qa:redis-capacity:integration",
  ])
    assert.equal(manifest.scripts[aggregate].includes(forbidden), false)
  assert.match(
    read(".github/workflows/backend.yml"),
    /run: pnpm run qa:disposable-integration --no-build/u
  )
})

for (const name of names) {
  test(`rejects removal of shared aggregate member ${name}`, () => {
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          scripts[aggregate] = removeCommand(
            scripts[aggregate],
            `pnpm run ${name}`
          )
        })
      )
    )
  })
  test(`rejects bypassed command definition for ${name}`, () => {
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          scripts[name] = "true"
        })
      )
    )
  })
}

for (const suffix of [
  " && true",
  " || true",
  "; true",
  " # ignored",
  "\ntrue",
]) {
  test(`rejects aggregate shell bypass ${JSON.stringify(suffix)}`, () => {
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          scripts[aggregate] += suffix
        })
      )
    )
  })
}

test("rejects duplicate, reordered, nested, or directly repeated shared members", () => {
  for (const change of [
    (scripts) => {
      scripts[aggregate] += ` && pnpm run ${names[0]}`
    },
    (scripts) => {
      scripts[aggregate] = scripts[aggregate]
        .split(" && ")
        .reverse()
        .join(" && ")
    },
    (scripts) => {
      scripts[aggregate] += ` && pnpm run ${boundary}`
    },
    (scripts) => {
      scripts["qa:lint"] += ` && pnpm run ${names[0]}`
    },
  ])
    assert.throws(() => validate(mutateScripts(change)))
})

test("rejects future local gates without an explicit CI mapping", () => {
  assert.throws(() =>
    validate(
      mutateScripts((scripts) => {
        scripts["qa:future-contract"] = "node scripts/future-contract.mjs"
        scripts["qa:lint"] = scripts["qa:lint"].replace(
          " && pnpm --filter remorseless-records-storefront",
          " && pnpm run qa:future-contract && pnpm --filter remorseless-records-storefront"
        )
      })
    )
  )
})

for (const name of [aggregate, boundary, toolchain, posthog]) {
  test(`requires exactly one local ${name} invocation`, () => {
    for (const change of [
      (scripts) => {
        scripts["qa:lint"] = removeCommand(
          scripts["qa:lint"],
          `pnpm run ${name}`
        )
      },
      (scripts) => {
        scripts["qa:lint"] += ` && pnpm run ${name}`
      },
    ])
      assert.throws(() => validate(mutateScripts(change)))
  })
  test(`requires one executable Root ${name} invocation rather than a comment or folded block`, () => {
    for (const replacement of [
      "        run: true",
      `        # run: pnpm run ${name}`,
      `        run: |\n          pnpm run ${name}`,
      `        run: pnpm run ${name} || true`,
    ])
      assert.throws(() =>
        validate(
          manifest,
          replaceWorkflow(`        run: pnpm run ${name}\n`, `${replacement}\n`)
        )
      )
  })
  test(`rejects duplicate Root ${name} invocation`, () => {
    const needle = `        run: pnpm run ${name}\n`
    assert.throws(() =>
      validate(
        manifest,
        replaceWorkflow(
          needle,
          `${needle}      - name: Duplicate invocation\n${needle}`
        )
      )
    )
  })
  for (const control of [
    "if: false",
    "if: always()",
    '"if": false',
    "if : false",
    "continue-on-error: true",
    '"continue-on-error": true',
    "shell: bash -c 'true' {0}",
    "env: { NODE_OPTIONS: '--help' }",
  ]) {
    test(`rejects ${name} step control ${control}`, () => {
      const needle = `        run: pnpm run ${name}\n`
      assert.throws(() =>
        validate(
          manifest,
          replaceWorkflow(needle, `        ${control}\n${needle}`)
        )
      )
    })
  }
}

for (const control of [
  "if: false",
  '"if": false',
  "if : false",
  "continue-on-error: true",
  '"continue-on-error": true',
  "strategy: { matrix: { ignored: [] } }",
  "defaults:\n      run:\n        shell: bash -c 'true' {0}",
]) {
  test(`rejects Root security job bypass ${control}`, () => {
    assert.throws(() =>
      validate(
        manifest,
        replaceWorkflow("  security:\n", `  security:\n    ${control}\n`)
      )
    )
  })
}

test("rejects inherited workflow defaults or environment controls", () => {
  for (const controls of [
    "defaults:\n  run:\n    shell: bash -c 'true' {0}\n",
    "\"defaults\":\n  run:\n    shell: bash -c 'true' {0}\n",
    "env:\n  NODE_OPTIONS: --help\n",
  ])
    assert.throws(() =>
      validate(manifest, replaceWorkflow("jobs:\n", `${controls}jobs:\n`))
    )
})

test("rejects bypass controls after steps, YAML aliases, and duplicate security jobs", () => {
  assert.throws(() =>
    validate(
      manifest,
      replaceWorkflow(
        "  supply-chain-artifacts:\n",
        "    if: false\n  supply-chain-artifacts:\n"
      )
    )
  )
  assert.throws(() =>
    validate(
      manifest,
      replaceWorkflow("  security:\n", "  security:\n    <<: *bypass\n")
    )
  )
  assert.throws(() =>
    validate(manifest, `${workflow}\n  security:\n    steps: []\n`)
  )
})

test("rejects trigger path filters, quoted duplicate job keys, and merge shadowing", () => {
  for (const [from, to] of [
    ["  push:\n", '  push:\n    paths: ["never/**"]\n'],
    ["  pull_request:\n", '  pull_request:\n    paths-ignore: ["**"]\n'],
    ["  security:\n", "  security:\n    needs: dependency-review\n"],
    ["jobs:\n", "jobs:\n  <<: *shadow\n"],
  ])
    assert.throws(() => validate(manifest, replaceWorkflow(from, to)))
  for (const appended of [
    '\n"jobs": {}\n',
    '\n  "security": { if: false }\n',
    "\n  'security': { if: false }\n",
  ])
    assert.throws(() => validate(manifest, workflow + appended))
})

test("requires frozen install before the independent guard and aggregate", () => {
  const guard =
    "      - name: Verify shared contract CI parity\n        run: pnpm run qa:ci-shared-contracts-boundary\n"
  const shared =
    "      - name: Verify shared repository contracts\n        run: pnpm run qa:ci-shared-contracts\n"
  assert.throws(() =>
    validate(
      manifest,
      replaceWorkflow(`${guard}${shared}`, `${shared}${guard}`)
    )
  )
  assert.throws(() =>
    validate(
      manifest,
      replaceWorkflow(
        "        run: pnpm install --frozen-lockfile\n",
        "        run: pnpm install\n"
      )
    )
  )
  assert.throws(() =>
    validate(
      mutateScripts((scripts) => {
        scripts["qa:lint"] = scripts["qa:lint"].replace(
          `pnpm run ${boundary} && pnpm run ${aggregate}`,
          `pnpm run ${aggregate} && pnpm run ${boundary}`
        )
      })
    )
  )
})

test("preserves existing explicit security checks and both local typechecks", () => {
  for (const entry of manifest.scripts["qa:lint"]
    .split(" && ")
    .filter((entry) => !entry.includes(aggregate)))
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          scripts["qa:lint"] = removeCommand(scripts["qa:lint"], entry)
        })
      )
    )
  assert.throws(() =>
    validate(
      manifest,
      replaceWorkflow(
        "        run: pnpm run qa:ci-runtime-security\n",
        "        run: true\n"
      )
    )
  )
})

for (const axis of ["lines", "branches", "functions"]) {
  test(`rejects relaxed or removed toolchain ${axis} coverage`, () => {
    for (const replacement of [`--test-coverage-${axis}=79`, ""])
      assert.throws(() =>
        validate(
          mutateScripts((scripts) => {
            scripts[toolchain] = scripts[toolchain].replace(
              `--test-coverage-${axis}=80`,
              replacement
            )
          })
        )
      )
  })
  test(`rejects relaxed or removed parity-validator ${axis} coverage`, () => {
    for (const replacement of [`--test-coverage-${axis}=79`, ""])
      assert.throws(() =>
        validate(
          mutateScripts((scripts) => {
            scripts[boundary] = scripts[boundary].replace(
              `--test-coverage-${axis}=80`,
              replacement
            )
          })
        )
      )
  })
  test(`rejects relaxed or removed Redis ${axis} coverage`, () => {
    for (const replacement of [`--test-coverage-${axis}=79`, ""])
      assert.throws(() =>
        validate(
          mutateScripts((scripts) => {
            scripts["qa:redis-capacity"] = scripts["qa:redis-capacity"].replace(
              `--test-coverage-${axis}=80`,
              replacement
            )
          })
        )
      )
  })
}

test("rejects disabled parity coverage or omitted validator coverage scope", () => {
  for (const marker of [
    "--experimental-test-coverage",
    "--test-coverage-include=scripts/verify-ci-shared-contracts.mjs",
  ])
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          scripts[boundary] = scripts[boundary].replace(marker, "")
        })
      )
    )
})

test("preserves exact toolchain test scopes and ownership-refusing prepare", () => {
  for (const marker of [
    "--test-isolation=process",
    "--test-timeout=60000",
    "--experimental-test-coverage",
    "--test-coverage-include=scripts/install-git-hooks.mjs",
    "--test-coverage-include=scripts/run-git-hook.mjs",
    "scripts/git-hooks.test.mjs",
    "scripts/tsx-runtime.test.mjs",
  ])
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          scripts[toolchain] = scripts[toolchain].replace(marker, "")
        })
      )
    )
  for (const prepare of [
    "true",
    "lefthook install",
    "node scripts/install-git-hooks.mjs --migrate-legacy",
    "node scripts/install-git-hooks.mjs || true",
  ])
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          scripts.prepare = prepare
        })
      )
    )
  assert.throws(() =>
    validate(
      mutateScripts((scripts) => {
        scripts[toolchain] += " || true"
      })
    )
  )
})

test("rejects disabled toolchain isolation and relaxed runtime limits", () => {
  for (const [from, to] of [
    ["--test-isolation=process", "--test-isolation=none"],
    ["--test-timeout=60000", "--test-timeout=0"],
    ["--test-timeout=60000", "--test-timeout=120000"],
  ])
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          scripts[toolchain] = scripts[toolchain].replace(from, to)
        })
      )
    )
})

test("requires parity guard before project toolchain contracts", () => {
  const step =
    "      - name: Verify project hook and loader runtime contracts\n        run: pnpm run qa:toolchain-runtime\n"
  const changed = workflow
    .replace(step, "")
    .replace(
      "      - name: Verify shared contract CI parity\n",
      `${step}      - name: Verify shared contract CI parity\n`
    )
  assert.notEqual(changed, workflow)
  assert.throws(() => validate(manifest, changed))
})

test("preserves exact PostHog runtime command, isolation, deadline, and scope", () => {
  for (const replacement of [
    "true",
    "node scripts/posthog-runtime.test.mjs",
    `${manifest.scripts[posthog]} || true`,
    `${manifest.scripts[posthog]} --test-name-pattern=never`,
  ])
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          scripts[posthog] = replacement
        })
      )
    )
  for (const [from, to] of [
    ["--test-isolation=process", ""],
    ["--test-isolation=process", "--test-isolation=none"],
    ["--test-timeout=30000", ""],
    ["--test-timeout=30000", "--test-timeout=0"],
    ["--test-timeout=30000", "--test-timeout=60000"],
    ["scripts/posthog-runtime.test.mjs", ""],
    ["scripts/posthog-runtime.test.mjs", "scripts/tsx-runtime.test.mjs"],
  ])
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          scripts[posthog] = scripts[posthog].replace(from, to)
        })
      )
    )
})

test("requires local PostHog immediately after toolchain and after parity guard", () => {
  for (const change of [
    (chain) =>
      chain.replace(
        `pnpm run ${toolchain} && pnpm run ${posthog}`,
        `pnpm run ${posthog} && pnpm run ${toolchain}`
      ),
    (chain) =>
      chain
        .replace(` && pnpm run ${posthog}`, "")
        .replace(
          " && pnpm run qa:release-policy",
          ` && pnpm run qa:release-policy && pnpm run ${posthog}`
        ),
    (chain) =>
      chain
        .replace(` && pnpm run ${toolchain} && pnpm run ${posthog}`, "")
        .replace(
          ` && pnpm run ${boundary}`,
          ` && pnpm run ${toolchain} && pnpm run ${posthog} && pnpm run ${boundary}`
        ),
  ])
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          const changed = change(scripts["qa:lint"])
          assert.notEqual(changed, scripts["qa:lint"])
          scripts["qa:lint"] = changed
        })
      )
    )
})

test("requires named Root PostHog step immediately after toolchain and after guard", () => {
  const runtime =
    "      - name: Verify project hook and loader runtime contracts\n        run: pnpm run qa:toolchain-runtime\n"
  const provider =
    "      - name: Verify PostHog transport runtime contracts\n        run: pnpm run qa:posthog-runtime\n"
  for (const changed of [
    replaceWorkflow(`${runtime}${provider}`, `${provider}${runtime}`),
    replaceWorkflow(
      `${runtime}${provider}`,
      `${runtime}      - name: Interposed bypass\n        run: true\n${provider}`
    ),
    replaceWorkflow(
      "      - name: Verify PostHog transport runtime contracts\n",
      "      - name: Unreviewed provider runtime\n"
    ),
    workflow
      .replace(`${runtime}${provider}`, "")
      .replace(
        "      - name: Verify shared contract CI parity\n",
        `${runtime}${provider}      - name: Verify shared contract CI parity\n`
      ),
  ]) {
    assert.notEqual(changed, workflow)
    assert.throws(() => validate(manifest, changed))
  }
})

test("rejects omitted Redis helper scopes, tests, and the independent parity test runner", () => {
  for (const marker of [
    "--test-coverage-include=scripts/lib/cli-arguments.mjs",
    "scripts/redis-audit-client.test.mjs",
    "scripts/redis-audit-cli.test.mjs",
  ])
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          scripts["qa:redis-capacity"] = scripts["qa:redis-capacity"].replace(
            marker,
            ""
          )
        })
      )
    )
  assert.throws(() =>
    validate(
      mutateScripts((scripts) => {
        scripts[boundary] = "node scripts/verify-ci-shared-contracts.mjs"
      })
    )
  )
})

test("rejects malformed or oversized workflow and package-script inputs", () => {
  for (const rootWorkflow of [
    null,
    "",
    "x".repeat(131073),
    "\n".repeat(4096),
    workflow.replace("  security:", "\tsecurity:"),
    workflow.replace("jobs:", "# jobs:"),
  ])
    assert.throws(() => validate(manifest, rootWorkflow))
  for (const value of [null, "", "x".repeat(16385), "true\u0000"])
    assert.throws(() =>
      validate(
        mutateScripts((scripts) => {
          scripts[aggregate] = value
        })
      )
    )
  assert.throws(() => validate({}))
})
