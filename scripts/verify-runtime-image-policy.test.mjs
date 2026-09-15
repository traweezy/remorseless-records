import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  validateRuntimeDockerfileSource,
  validateRuntimeImagePolicyManifest,
  validateRuntimeWorkflowSource,
} from "./verify-runtime-image-policy.mjs"
const workflowSource = readFileSync(
  new URL("../.github/workflows/runtime-images.yml", import.meta.url),
  "utf8"
)
test("rejects an incomplete policy manifest", () => {
  assert.throws(() => validateRuntimeImagePolicyManifest({ schemaVersion: 1 }))
})

for (const service of ["backend", "storefront"]) {
  const dockerfile = readFileSync(
    new URL(`../${service}/Dockerfile.runtime`, import.meta.url),
    "utf8"
  )
  test(`accepts ${service} with only the verified Debian security package`, () => {
    assert.doesNotThrow(() =>
      validateRuntimeDockerfileSource(service, dockerfile)
    )
  })
  const mutations = [
    ["unverified archive", "ADD --checksum=sha256:", "ADD --checksum=sha512:"],
    [
      "wrong amd64 hash",
      "81c5502941118a24d47af69a17b8b0b9548d75cc6d72b3eb3fe01047b46fa10e",
      "a".repeat(64),
    ],
    [
      "wrong arm64 hash",
      "d178d33697eef877c2c27733141b7f8520fee66a329ae5809e8c8eae3709efa3",
      "b".repeat(64),
    ],
    [
      "unreviewed source",
      "https://security.debian.org/",
      "https://example.com/",
    ],
    [
      "plaintext source",
      "https://security.debian.org/",
      "http://security.debian.org/",
    ],
    ["floating package", "10.42-1+deb12u1", "latest"],
    ["unsupported architecture", "amd64|arm64)", "amd64|arm64|ppc64le)"],
    ["architecture failure bypass", "*) exit 1 ;;", "*) exit 0 ;;"],
    ["writable archive mount", ",readonly", ""],
    [
      "package identity bypass",
      'Package)" = libpcre2-8-0',
      'Package)" = anything',
    ],
    [
      "package version bypass",
      'Version)" = 10.42-1+deb12u1',
      'Version)" = anything',
    ],
    [
      "architecture identity bypass",
      "dpkg --print-architecture",
      "printf amd64",
    ],
    [
      "archive architecture bypass",
      'Architecture)" = "$TARGETARCH"',
      'Architecture)" = amd64',
    ],
    [
      "unsigned package forcing",
      "dpkg --install",
      "dpkg --force-all --install",
    ],
    ["installed status bypass", "${db:Status-Status}", "ignored"],
    [
      "extra package installation",
      "ARG REVISION",
      "RUN apt-get update && apt-get install -y curl\nARG REVISION",
    ],
    [
      "extra archive download",
      "ARG REVISION",
      "ADD https://example.com/archive /archive\nARG REVISION",
    ],
    ["extra external stage", "ARG REVISION", "FROM node:latest\nARG REVISION"],
  ]
  for (const [label, from, to] of mutations) {
    test(`rejects ${service} runtime package with ${label}`, () => {
      const changed = dockerfile.replace(from, to)
      assert.notEqual(changed, dockerfile)
      assert.throws(() => validateRuntimeDockerfileSource(service, changed))
    })
  }
}

test("accepts split read-only validation and master-only publication", () => {
  assert.doesNotThrow(() => validateRuntimeWorkflowSource(workflowSource))
})

test("rejects manual publication outside the exact master ref", () => {
  const broadened = workflowSource.replace(
    "github.ref == 'refs/heads/master' && (github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.publish == true))",
    "github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.publish == true)"
  )
  assert.notEqual(broadened, workflowSource)
  assert.throws(() => validateRuntimeWorkflowSource(broadened))
})

test("rejects write permissions on the validation job", () => {
  const broadened = workflowSource.replace(
    "permissions:\n      contents: read\n    strategy:",
    "permissions:\n      contents: read\n      packages: write\n    strategy:"
  )
  assert.notEqual(broadened, workflowSource)
  assert.throws(() => validateRuntimeWorkflowSource(broadened))
})

test("rejects a publication path that skips smoke or exact-image push", () => {
  const skippedSmoke = workflowSource.replace(
    "- name: Smoke exact runtime image\n        shell: bash",
    "- name: Smoke exact runtime image\n        if: ${{ github.event_name == 'push' }}\n        shell: bash"
  )
  assert.notEqual(skippedSmoke, workflowSource)
  assert.throws(() => validateRuntimeWorkflowSource(skippedSmoke))

  const skippedPush = workflowSource.replace(
    'docker push "${IMAGE_REF}"',
    'echo "${IMAGE_REF}"'
  )
  assert.notEqual(skippedPush, workflowSource)
  assert.throws(() => validateRuntimeWorkflowSource(skippedPush))
})

test("rejects scan evidence redirected outside its private artifact directory", () => {
  const changed = workflowSource.replace(
    "--output artifacts",
    "--output /tmp/unbound"
  )
  assert.notEqual(changed, workflowSource)
  assert.throws(() => validateRuntimeWorkflowSource(changed))
})

test("rejects a Storefront runtime image built without standalone output", () => {
  const defaultBuild = workflowSource.replaceAll(
    "pnpm --filter remorseless-records-storefront run build:runtime",
    "pnpm --filter remorseless-records-storefront run build"
  )
  assert.notEqual(defaultBuild, workflowSource)
  assert.throws(() => validateRuntimeWorkflowSource(defaultBuild))
})

const decoderName = "      - name: Test packaged Storefront image decoders\n"
const workflowJobStart = (jobName) => {
  const match = new RegExp(`^  ${jobName}:\\n`, "mu").exec(workflowSource)
  assert.ok(match)
  return match.index
}
const stepForJob = (jobName, stepName) => {
  const jobStart = workflowJobStart(jobName)
  const start = workflowSource.indexOf(stepName, jobStart)
  const end = workflowSource.indexOf("\n      - ", start + 1)
  assert(start > jobStart && end > start)
  return workflowSource.slice(start, end).trimEnd()
}

const mutateJob = (jobName, change) => {
  const start = workflowJobStart(jobName)
  const next = workflowSource.indexOf("\n  publish:\n", start + 1)
  const end = next === -1 ? workflowSource.length : next
  const job = workflowSource.slice(start, end)
  const changed = change(job)
  assert.notEqual(changed, job)
  return workflowSource.slice(0, start) + changed + workflowSource.slice(end)
}

const decoderMutations = [
  ["wrong service condition", "matrix.service == 'storefront'", "false"],
  [
    "conditional continue-on-error",
    "        shell: bash",
    "        continue-on-error: true\n        shell: bash",
  ],
  [
    "quoted duplicate run",
    "        run: |",
    '        "run": echo bypass\n        run: |',
  ],
  ["wrong shell", "        shell: bash", "        shell: sh"],
  ["unbounded step", "        timeout-minutes: 2\n", ""],
  [
    "tag instead of resolved image ID",
    '--entrypoint node "$image_id"',
    '--entrypoint node "${IMAGE_REF}"',
  ],
  [
    "host executable instead of packaged Node",
    "--entrypoint node",
    "--entrypoint /bin/true",
  ],
  ["remote image pull", "--pull never", "--pull always"],
  ["host networking", "--network none", "--network host"],
  ["writable root filesystem", " --read-only", ""],
  ["retained capabilities", " --cap-drop ALL", ""],
  ["privilege escalation", "--security-opt no-new-privileges", "--privileged"],
  ["unbounded memory", "--memory 256m ", ""],
  ["unbounded CPU", "--cpus 1 ", ""],
  ["unbounded processes", "--pids-limit 64", ""],
  ["writable test mount", ',readonly"', '\"'],
  [
    "host directory mount",
    "source=${GITHUB_WORKSPACE}/storefront/scripts/image-optimizer.runtime.test.mjs",
    "source=${GITHUB_WORKSPACE}",
  ],
  [
    "test outside packaged dependency resolution",
    "target=/app/storefront/image-optimizer.runtime.test.mjs",
    "target=/tmp/image-optimizer.runtime.test.mjs",
  ],
  [
    "host secret passthrough",
    "--entrypoint node",
    "--env CART_COOKIE_SECRET --entrypoint node",
  ],
  ["missing test process isolation", " --test-isolation=process", ""],
  ["missing test timeout", " --test-timeout=30000", ""],
  [
    "wrong test entrypoint",
    "            /app/storefront/image-optimizer.runtime.test.mjs)",
    "            /app/storefront/server.js)",
  ],
  [
    "missing execution deadline",
    "timeout --signal=TERM --kill-after=10s 45s ",
    "",
  ],
  [
    "swallowed decoder failure",
    'docker start --attach "$container_id"',
    'docker start --attach "$container_id" || true',
  ],
  [
    "missing exited-zero assertion",
    "          test \"$(docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' \"$container_id\")\" = 'exited 0'",
    "          true",
  ],
  ["missing owned cleanup", "          trap cleanup EXIT\n", ""],
  ["unbounded cleanup", "timeout --signal=TERM --kill-after=5s 10s ", ""],
]

for (const jobName of ["validate", "publish"]) {
  const decoderStep = stepForJob(jobName, decoderName)
  for (const [label, from, to] of decoderMutations) {
    test(`rejects ${jobName} decoder smoke with ${label}`, () => {
      const changedStep = decoderStep.replace(from, to)
      assert.notEqual(changedStep, decoderStep)
      const mutated = mutateJob(jobName, (job) =>
        job.replace(decoderStep, changedStep)
      )
      assert.throws(() => validateRuntimeWorkflowSource(mutated))
    })
  }

  test(`rejects missing, duplicated, or late ${jobName} decoder smoke`, () => {
    for (const change of [
      (job) => job.replace(`${decoderStep}\n\n`, ""),
      (job) => job.replace(decoderStep, `${decoderStep}\n\n${decoderStep}`),
      (job) => `${job.replace(`${decoderStep}\n\n`, "")}\n${decoderStep}\n`,
    ]) {
      const mutated = mutateJob(jobName, change)
      assert.throws(() => validateRuntimeWorkflowSource(mutated))
    }
  })

  test(`rejects ${jobName} job controls that bypass decoder acceptance`, () => {
    for (const control of [
      "    continue-on-error: true\n",
      '    "continue-on-error": true\n',
      "    if : false\n",
      '    "if": false\n',
      "    if: false\n",
      "    needs: nonexistent\n",
    ]) {
      const mutated = mutateJob(jobName, (job) =>
        job.replace("    steps:\n", `${control}    steps:\n`)
      )
      assert.throws(() => validateRuntimeWorkflowSource(mutated))
    }
  })

  test(`rejects ${jobName} without a Storefront matrix member`, () => {
    const mutated = mutateJob(jobName, (job) =>
      job.replace(
        "          - service: storefront",
        "          - service: frontend"
      )
    )
    assert.throws(() => validateRuntimeWorkflowSource(mutated))
  })

  test(`rejects ${jobName} decoder identity resolution bypass`, () => {
    const identityStep = stepForJob(
      jobName,
      "      - name: Resolve local runtime image digest\n"
    )
    for (const change of [
      (job) => job.replace(`${identityStep}\n\n`, ""),
      (job) => job.replace(identityStep, `${identityStep}\n\n${identityStep}`),
      (job) =>
        job.replace(
          identityStep,
          identityStep.replace(
            "        shell: bash",
            "        if: false\n        shell: bash"
          )
        ),
      (job) =>
        job.replace(
          identityStep,
          identityStep.replace("{{.Id}}", "{{.RepoDigests}}")
        ),
      (job) =>
        job.replace(
          identityStep,
          identityStep.replace("[0-9a-f]{64}", "[0-9a-f]{40}")
        ),
      (job) =>
        job
          .replace(`${identityStep}\n\n`, "")
          .replace(decoderStep, `${decoderStep}\n\n${identityStep}`),
    ]) {
      const mutated = mutateJob(jobName, change)
      assert.throws(() => validateRuntimeWorkflowSource(mutated))
    }

    const output = jobName === "validate" ? "image" : "local_image"
    const mutated = mutateJob(jobName, (job) =>
      job.replace(
        decoderStep,
        decoderStep.replace(
          `steps.${output}.outputs.digest`,
          "steps.unrelated.outputs.digest"
        )
      )
    )
    assert.throws(() => validateRuntimeWorkflowSource(mutated))
  })
}

for (const jobName of ["validate", "publish"]) {
  const scan = stepForJob(
    jobName,
    "      - name: Scan runtime image for critical and high vulnerabilities\n"
  )
  for (const [label, from, to] of [
    [
      "skip condition",
      "        shell: bash",
      "        if: false\n        shell: bash",
    ],
    ["swallowed failure", "--output artifacts", "--output artifacts || true"],
    ["tag subject", /--image-id "[^\n]+"/u, '--image-id "${IMAGE_REF}"'],
    ["wrong revision", '--revision "${GITHUB_SHA}"', '--revision "unrelated"'],
    [
      "wrong service",
      '--service "${{ matrix.service }}"',
      '--service "backend"',
    ],
    ["no deadline", "        timeout-minutes: 16\n", ""],
    [
      "continue on error",
      "        shell: bash",
      "        continue-on-error: true\n        shell: bash",
    ],
  ])
    test(`rejects ${jobName} scan with ${label}`, () => {
      const changed = scan.replace(from, to)
      assert.notEqual(changed, scan)
      assert.throws(() =>
        validateRuntimeWorkflowSource(
          mutateJob(jobName, (job) => job.replace(scan, changed))
        )
      )
    })
  test(`rejects ${jobName} scanner cache reuse or binary setup drift`, () => {
    for (const change of [
      (job) => job.replace("          cache: false", "          cache: true"),
      (job) =>
        job.replace("          version: v0.70.0", "          version: latest"),
    ])
      assert.throws(() =>
        validateRuntimeWorkflowSource(mutateJob(jobName, change))
      )
  })
  test(`rejects ${jobName} omitted failure artifacts or expanded DB upload paths`, () => {
    for (const change of [
      (job) =>
        job.replace(
          "        if: ${{ always() }}\n        uses: actions/upload-artifact",
          "        uses: actions/upload-artifact"
        ),
      (job) =>
        job.replace(
          "            artifacts/*.db.json",
          "            /tmp/rr-runtime-trivy-*/db/trivy.db"
        ),
    ])
      assert.throws(() =>
        validateRuntimeWorkflowSource(mutateJob(jobName, change))
      )
  })
}
