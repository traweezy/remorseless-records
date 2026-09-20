import assert from "node:assert/strict"
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
      jobs: application === "storefront" ? 11 : 9,
      parallelRuntimeGates: application === "storefront" ? 5 : 2,
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
      ? ["unit", "build", "e2e", "accessibility", "lighthouse"]
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
    const command = `        run: pnpm --filter ${application === "storefront" ? "remorseless-records-storefront" : "backend"} run test:coverage`
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

test("Backend build still requires successful disposable integration", () => {
  assert.throws(() =>
    validate(
      "backend",
      mutateJob(workflows.backend, "build", (job) =>
        job.replace(", integration]", "]")
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
    ["e2e", "pnpm --filter remorseless-records-storefront run build"],
    ["accessibility", "pnpm --filter remorseless-records-storefront run build"],
    ["lighthouse", "pnpm --filter remorseless-records-storefront run build"],
    [
      "e2e",
      "pnpm --filter remorseless-records-storefront run test:runtime:observability",
    ],
    [
      "e2e",
      "pnpm --filter remorseless-records-storefront run test:e2e --config=playwright.ci.config.ts",
    ],
    ["e2e", "pnpm run qa:storefront:launch"],
    [
      "e2e",
      "pnpm --filter remorseless-records-storefront run test:e2e:critical",
    ],
    ["accessibility", "pnpm run qa:a11y"],
    ["lighthouse", "pnpm run qa:lighthouse"],
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

// Evaluate only the literal comparisons and OR-of-AND form used by these
// checked-in GitHub conditions. No eval, arbitrary expressions, or providers.
const evaluateCondition = (condition, context) => {
  assert.ok(condition.startsWith("${{ ") && condition.endsWith(" }}"))
  return condition
    .slice(4, -3)
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
          ["e2e", "E2E"],
          ["accessibility", "A11Y"],
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
    ["e2e", "E2E"],
    ["accessibility", "A11Y"],
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
