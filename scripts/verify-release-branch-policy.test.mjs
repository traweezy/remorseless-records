import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  validateApplicationReleaseGraph,
  validateReleaseBranches,
} from "./verify-release-branch-policy.mjs"

const workflows = Object.fromEntries(
  ["backend", "storefront"].map((name) => [
    name,
    readFileSync(
      new URL(`../.github/workflows/${name}.yml`, import.meta.url),
      "utf8"
    ),
  ])
)
const mutateJob = (source, name, change) => {
  const pattern = new RegExp(
    `^  ${name}:\\n[\\s\\S]*?(?=^  [a-z][a-z0-9-]*:|$(?![\\s\\S]))`,
    "mu"
  )
  const original = source.match(pattern)?.[0]
  assert.ok(original, `Missing fixture job ${name}`)
  const changed = change(original)
  assert.notEqual(
    changed,
    original,
    "Mutation must actually change the fixture"
  )
  return source.replace(original, changed)
}
const validate = (application, source = workflows[application]) =>
  validateApplicationReleaseGraph(source, application)

for (const application of ["backend", "storefront"]) {
  test(`${application} retains every required security gate and parallel runtime graph`, () => {
    assert.deepEqual(validate(application), {
      application,
      jobs: application === "storefront" ? 15 : 9,
      parallelRuntimeGates: application === "storefront" ? 7 : 2,
    })
    validateReleaseBranches(workflows[application], application)
  })

  for (const gate of ["lint", "typecheck", "codeql", "secrets"]) {
    test(`${application} rejects a missing or bypassed ${gate} gate`, () => {
      assert.throws(() =>
        validate(
          application,
          mutateJob(workflows[application], gate, () => "")
        )
      )
      assert.throws(() =>
        validate(
          application,
          mutateJob(workflows[application], gate, (job) =>
            job.replace("    needs: security", "    needs: dependency-review")
          )
        )
      )
      assert.throws(() =>
        validate(
          application,
          mutateJob(workflows[application], gate, (job) =>
            job.replace("    steps:", "    if: false\n    steps:")
          )
        )
      )
    })
  }

  const runtimeJobs =
    application === "storefront"
      ? [
          "unit",
          "build",
          "e2e-responsive",
          "e2e-critical",
          "accessibility",
          "lighthouse-content",
          "lighthouse-commerce",
        ]
      : ["unit", "build"]
  for (const name of runtimeJobs) {
    test(`${application}.${name} rejects removed prerequisites, restored serial waits, and failure suppression`, () => {
      const source = workflows[application]
      const prerequisites =
        name === "build"
          ? ["lint", "typecheck", "codeql", "secrets"]
          : ["lint", "typecheck", "secrets"]
      for (const gate of prerequisites) {
        const changed = mutateJob(source, name, (job) =>
          job.replace(
            /^    needs: \[([^\]]+)\]/mu,
            (_line, parents) =>
              `    needs: [${parents
                .split(", ")
                .filter((parent) => parent !== gate)
                .join(", ")}]`
          )
        )
        assert.throws(() => validate(application, changed))
      }
      if (name !== "build") {
        assert.throws(() =>
          validate(
            application,
            mutateJob(source, name, (job) =>
              job.replace(
                "    needs: [lint, typecheck, secrets]",
                "    needs: [lint, typecheck, codeql, secrets]"
              )
            )
          )
        )
      }
      for (const controls of [
        "    continue-on-error: true",
        "    'continue-on-error': true",
        "    needs: [unit]",
        "    needs: [nonexistent]",
      ]) {
        assert.throws(() =>
          validate(
            application,
            mutateJob(source, name, (job) =>
              job.replace("    steps:", `${controls}\n    steps:`)
            )
          )
        )
      }
      assert.throws(() =>
        validate(
          application,
          mutateJob(source, name, (job) =>
            job.replace(/^    needs: .*$/mu, "    needs: [unit]")
          )
        )
      )
    })
  }

  test(`${application} rejects missing, duplicate, or conditional coverage commands`, () => {
    const command =
      application === "storefront"
        ? "        run: pnpm --filter remorseless-records-storefront run test:coverage"
        : "        run: pnpm --filter backend run test:coverage --runInBand=false --maxWorkers=2"
    for (const replacement of [
      "        run: true",
      `        if: false\n${command}`,
      `        continue-on-error: true\n${command}`,
      `        shell: bash -c 'true' {0}\n${command}`,
      `        env: { NODE_OPTIONS: '--help' }\n${command}`,
      `${command}\n        run: true`,
      `${command}\n        'run': true`,
      `${command}\n      - name: Duplicate coverage\n${command}`,
    ]) {
      assert.throws(() =>
        validate(
          application,
          workflows[application].replace(command, replacement)
        )
      )
    }
  })

  if (application === "backend") {
    test("Backend coverage retains two-worker cap and serial execution override", () => {
      const command =
        "        run: pnpm --filter backend run test:coverage --runInBand=false --maxWorkers=2"
      for (const replacement of [
        "        run: pnpm --filter backend run test:coverage",
        "        run: pnpm --filter backend run test:coverage --maxWorkers=2",
        "        run: pnpm --filter backend run test:coverage --runInBand=false",
        "        run: pnpm --filter backend run test:coverage --runInBand=false --maxWorkers=4",
        `${command} || true`,
      ])
        assert.throws(() =>
          validate("backend", workflows.backend.replace(command, replacement))
        )
    })
  }

  test(`${application} rejects duplicate jobs, aliases and ambiguous job controls`, () => {
    for (const suffix of [
      "\n  unit:\n    steps: []\n",
      "\n  'unit': { if: false }\n",
      "\n  <<: *jobs\n",
    ])
      assert.throws(() =>
        validate(application, workflows[application] + suffix)
      )
    assert.throws(() =>
      validate(
        application,
        mutateJob(workflows[application], "unit", (job) =>
          job.replace("    steps:", "    if: always()\n    steps:")
        )
      )
    )
  })
}

test("Backend build and integration run after the required static gates", () => {
  assert.throws(() =>
    validate(
      "backend",
      mutateJob(workflows.backend, "build", (job) =>
        job.replace(
          "    needs: [lint, typecheck, codeql, secrets]",
          "    needs: [lint, typecheck, codeql, secrets, integration]"
        )
      )
    )
  )
  assert.throws(() =>
    validate(
      "backend",
      mutateJob(workflows.backend, "build", (job) =>
        job.replace(", codeql,", ",")
      )
    )
  )
  assert.throws(() =>
    validate(
      "backend",
      mutateJob(workflows.backend, "integration", (job) =>
        job.replace(
          "    needs: [lint, typecheck, secrets]",
          "    needs: security"
        )
      )
    )
  )
})

test("Storefront requires every independent build and all browser/a11y/performance commands", () => {
  for (const [name, command] of [
    [
      "e2e-responsive",
      "pnpm --filter remorseless-records-storefront run build",
    ],
    ["e2e-critical", "pnpm --filter remorseless-records-storefront run build"],
    ["accessibility", "pnpm --filter remorseless-records-storefront run build"],
    [
      "lighthouse-content",
      "pnpm --filter remorseless-records-storefront run build",
    ],
    [
      "lighthouse-commerce",
      "pnpm --filter remorseless-records-storefront run build",
    ],
    [
      "e2e-responsive",
      "pnpm --filter remorseless-records-storefront run test:runtime:observability",
    ],
    [
      "e2e-responsive",
      "pnpm --filter remorseless-records-storefront run test:e2e --config=playwright.ci.config.ts",
    ],
    ["e2e-responsive", "pnpm run qa:storefront:launch"],
    [
      "e2e-critical",
      "pnpm --filter remorseless-records-storefront run test:e2e:critical",
    ],
    ["accessibility", "pnpm run qa:a11y"],
    ["lighthouse-content", "pnpm run qa:lighthouse"],
    ["lighthouse-commerce", "pnpm run qa:lighthouse"],
  ]) {
    assert.throws(() =>
      validate(
        "storefront",
        mutateJob(workflows.storefront, name, (job) =>
          job.replace(`        run: ${command}`, "        run: true")
        )
      )
    )
  }
})

test("Storefront required check aggregates fail closed on either shard", () => {
  for (const [name, first, second, command] of [
    [
      "e2e",
      "e2e-responsive",
      "e2e-critical",
      'test "$RESPONSIVE_RESULT" = success && test "$CRITICAL_RESULT" = success',
    ],
    [
      "lighthouse",
      "lighthouse-content",
      "lighthouse-commerce",
      'test "$CONTENT_RESULT" = success && test "$COMMERCE_RESULT" = success',
    ],
  ]) {
    for (const broken of [
      (job) =>
        job.replace(
          `    needs: [${first}, ${second}]`,
          `    needs: [${first}]`
        ),
      (job) => job.replace("always() && ", ""),
      (job) => job.replace(`        run: ${command}`, "        run: true"),
      (job) =>
        job.replace(/^    name: .*$/mu, "    name: Bypassed aggregate check"),
      (job) => job.replace(`needs.${second}.result`, `needs.${first}.result`),
    ])
      assert.throws(() =>
        validate("storefront", mutateJob(workflows.storefront, name, broken))
      )
  }
})

test("Storefront shard names cannot duplicate protected check contexts", () => {
  for (const [name, protectedName] of [
    ["e2e-responsive", "Browser Smoke (storefront, Playwright)"],
    ["lighthouse-content", "Lighthouse (local build unless URL provided)"],
  ])
    assert.throws(() =>
      validate(
        "storefront",
        mutateJob(workflows.storefront, name, (job) =>
          job.replace(/^    name: .*$/mu, `    name: ${protectedName}`)
        )
      )
    )
})

test("Storefront keeps disjoint Lighthouse routes and three runs", () => {
  for (const [name, replacement] of [
    ["lighthouse-content", "          QA_LIGHTHOUSE_SHARD: commerce"],
    ["lighthouse-commerce", "          QA_LIGHTHOUSE_SHARD: content"],
  ])
    assert.throws(() =>
      validate(
        "storefront",
        mutateJob(workflows.storefront, name, (job) =>
          job.replace(/^          QA_LIGHTHOUSE_SHARD: .*$/mu, replacement)
        )
      )
    )
  assert.throws(() =>
    validate(
      "storefront",
      workflows.storefront.replace(
        "          QA_LIGHTHOUSE_SHARD: commerce",
        "          QA_LIGHTHOUSE_SHARD: commerce\n          QA_LIGHTHOUSE_RUNS: 1"
      )
    )
  )
})

const lighthouseConfig = (overrides = {}) => {
  const environment = {
    ...process.env,
    QA_BASE_URL: "http://127.0.0.1:3000",
    QA_PRODUCT_PATH: "/music-release/a,b",
  }
  for (const name of ["QA_PATHS", "QA_LIGHTHOUSE_SHARD", "QA_LIGHTHOUSE_RUNS"])
    delete environment[name]
  Object.assign(environment, overrides)
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      "process.stdout.write(JSON.stringify(require('./lighthouse/lhci.config.js').ci))",
    ],
    {
      cwd: new URL("../", import.meta.url),
      env: environment,
      encoding: "utf8",
    }
  )
  return {
    status: child.status,
    stderr: child.stderr,
    config: child.status === 0 ? JSON.parse(child.stdout) : undefined,
  }
}

test("Lighthouse shards retain six unique routes, three runs and assertions", () => {
  const baseline = lighthouseConfig()
  const content = lighthouseConfig({ QA_LIGHTHOUSE_SHARD: "content" })
  const commerce = lighthouseConfig({ QA_LIGHTHOUSE_SHARD: "commerce" })
  for (const result of [baseline, content, commerce])
    assert.equal(result.status, 0, result.stderr)
  const urls = baseline.config.collect.url
  assert.equal(urls.length, 6)
  assert.deepEqual(content.config.collect.url, urls.slice(0, 3))
  assert.deepEqual(commerce.config.collect.url, urls.slice(3))
  assert.equal(new Set(urls).size, 6)
  assert.ok(urls[2].endsWith("/music-release/a,b"))
  for (const result of [content, commerce]) {
    assert.equal(result.config.collect.numberOfRuns, 3)
    assert.deepEqual(result.config.assert, baseline.config.assert)
  }
  assert.notEqual(
    lighthouseConfig({ QA_LIGHTHOUSE_SHARD: "invalid" }).status,
    0
  )
  assert.notEqual(
    lighthouseConfig({
      QA_LIGHTHOUSE_SHARD: "content",
      QA_PATHS: "/cart",
    }).status,
    0
  )
})

// Evaluate only the literal comparisons and OR-of-AND form used by these
// checked-in GitHub conditions. No eval, arbitrary expressions, or providers.
const evaluateCondition = (condition, context) => {
  assert.ok(condition.startsWith("${{ ") && condition.endsWith(" }}"))
  const expression = condition.slice(4, -3)
  return (
    expression.startsWith("always() && (")
      ? expression.slice("always() && (".length, -1)
      : expression
  )
    .split(" || ")
    .some((term) =>
      term
        .replace(/^\(|\)$/gu, "")
        .split(" && ")
        .every((comparison) => {
          const match =
            /^(github\.[a-z_]+|vars\.[A-Z0-9_]+) (==|!=) '([a-z_]+)'$/u.exec(
              comparison
            )
          assert.ok(match, `Unsupported comparison ${comparison}`)
          assert.ok(Object.hasOwn(context, match[1]))
          return match[2] === "=="
            ? context[match[1]] === match[3]
            : context[match[1]] !== match[3]
        })
    )
}
const jobCondition = (name) => {
  const pattern = new RegExp(`^  ${name}:\\n[\\s\\S]*?^    if: (.+)$`, "mu")
  return workflows.storefront.match(pattern)?.[1]
}

test("all event/base/toggle combinations preserve the former build-dependent PR behavior", () => {
  for (const event of [
    "push",
    "pull_request",
    "schedule",
    "workflow_dispatch",
  ]) {
    for (const base of ["master", "staging"]) {
      for (let toggles = 0; toggles < 16; toggles++) {
        const flags = ["BUILD", "E2E", "A11Y", "LIGHTHOUSE"]
        const context = { "github.event_name": event, "github.base_ref": base }
        for (const [index, flag] of flags.entries())
          context[`vars.ENABLE_STOREFRONT_${flag}`] =
            toggles & (1 << index) ? "true" : "false"
        const alwaysEnabled = event !== "pull_request" || base === "master"
        const oldBuildRan =
          alwaysEnabled || context["vars.ENABLE_STOREFRONT_BUILD"] === "true"
        assert.equal(
          evaluateCondition(jobCondition("build"), context),
          oldBuildRan
        )
        for (const [name, flag] of [
          ["e2e-responsive", "E2E"],
          ["e2e-critical", "E2E"],
          ["e2e", "E2E"],
          ["accessibility", "A11Y"],
          ["lighthouse-content", "LIGHTHOUSE"],
          ["lighthouse-commerce", "LIGHTHOUSE"],
          ["lighthouse", "LIGHTHOUSE"],
        ]) {
          const oldLeafEnabled =
            alwaysEnabled ||
            context[`vars.ENABLE_STOREFRONT_${flag}`] === "true"
          assert.equal(
            evaluateCondition(jobCondition(name), context),
            oldBuildRan && oldLeafEnabled,
            `${name}: ${event}/${base}/${toggles}`
          )
        }
      }
    }
  }
})

test("Storefront rejects lost build opt-in, omitted master gates and broadened toggle conditions", () => {
  for (const [name, flag] of [
    ["e2e-responsive", "E2E"],
    ["e2e-critical", "E2E"],
    ["e2e", "E2E"],
    ["accessibility", "A11Y"],
    ["lighthouse-content", "LIGHTHOUSE"],
    ["lighthouse-commerce", "LIGHTHOUSE"],
    ["lighthouse", "LIGHTHOUSE"],
  ]) {
    for (const change of [
      (job) => job.replace("(vars.ENABLE_STOREFRONT_BUILD == 'true' && ", "("),
      (job) => job.replace(" && ", " || "),
      (job) => job.replace("github.base_ref == 'master' || ", ""),
      (job) => job.replace(`vars.ENABLE_STOREFRONT_${flag} == 'true'`, "true"),
    ])
      assert.throws(() =>
        validate("storefront", mutateJob(workflows.storefront, name, change))
      )
  }
})

test("release branch triggers and manual production remain enforced", () => {
  for (const source of Object.values(workflows)) {
    assert.throws(() =>
      validateReleaseBranches(
        source.replace("branches: [staging, master]", "branches: [master]"),
        "fixture"
      )
    )
    assert.throws(() =>
      validateReleaseBranches(
        `${source}\n    environment: production\n`,
        "fixture"
      )
    )
  }
})
