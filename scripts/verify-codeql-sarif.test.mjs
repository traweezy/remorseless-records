import assert from "node:assert/strict"
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import test from "node:test"

import { inspectCodeqlSarif } from "./verify-codeql-sarif.mjs"

const withSarif = async (reports, callback) => {
  const directory = await mkdtemp(join(tmpdir(), "rr-codeql-sarif-"))
  try {
    for (const [name, report] of Object.entries(reports)) {
      await writeFile(join(directory, name), JSON.stringify(report))
    }
    return await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const sarif = (results) => ({
  version: "2.1.0",
  runs: [
    {
      tool: {
        driver: { name: "CodeQL" },
        extensions: [
          {
            rules: [
              { id: "high", properties: { "security-severity": "7.7" } },
              { id: "medium", properties: { "security-severity": "6.3" } },
              {
                id: "js/http-to-file-access",
                properties: { "security-severity": "6.3" },
              },
            ],
          },
        ],
      },
      results,
    },
  ],
})
const finding = (ruleId, index) => ({
  ruleId,
  rule: { id: ruleId, index, toolComponent: { index: 0 } },
  level: "warning",
})

test("accepts complete, empty CodeQL results", async () => {
  await withSarif({ "javascript.sarif": sarif([]) }, async (directory) => {
    assert.deepEqual(await inspectCodeqlSarif(directory), {
      files: 1,
      findings: 0,
      blocking: 0,
      reviewedMedium: 0,
    })
  })
})

test("counts findings across every SARIF run and file", async () => {
  await withSarif(
    {
      "one.sarif": sarif([finding("high", 0)]),
      "two.sarif": sarif([finding("medium", 1)]),
    },
    async (directory) => {
      assert.deepEqual(await inspectCodeqlSarif(directory), {
        files: 2,
        findings: 2,
        blocking: 2,
        reviewedMedium: 0,
      })
      const result = spawnSync(
        process.execPath,
        [
          new URL("./verify-codeql-sarif.mjs", import.meta.url).pathname,
          directory,
        ],
        { encoding: "utf8" }
      )
      assert.notEqual(result.status, 0)
      assert.match(
        result.stderr,
        /CodeQL reported 2 unreviewed MEDIUM\/HIGH\/CRITICAL finding\(s\)/u
      )
    }
  )
})

test("rejects missing or malformed SARIF instead of passing an empty scan", async () => {
  await withSarif({}, async (directory) => {
    await assert.rejects(inspectCodeqlSarif(directory), /at least one SARIF/u)
  })
  await withSarif(
    { "empty.sarif": { version: "2.1.0", runs: [] } },
    async (directory) => {
      await assert.rejects(inspectCodeqlSarif(directory), /must contain a run/u)
    }
  )
  await withSarif(
    {
      "missing-results.sarif": {
        version: "2.1.0",
        runs: [{ tool: { driver: { name: "CodeQL" } } }],
      },
    },
    async (directory) => {
      await assert.rejects(
        inspectCodeqlSarif(directory),
        /results are missing/u
      )
    }
  )
  await withSarif(
    { "unknown.sarif": sarif([{ ruleId: "unknown" }]) },
    async (directory) => {
      await assert.rejects(inspectCodeqlSarif(directory), /identify its rule/u)
    }
  )
  const nullSeverity = sarif([finding("high", 0)])
  nullSeverity.runs[0].tool.extensions[0].rules[0].properties[
    "security-severity"
  ] = null
  await withSarif(
    { "null-severity.sarif": nullSeverity },
    async (directory) => {
      await assert.rejects(inspectCodeqlSarif(directory), /security severity/u)
    }
  )
})

test("accepts only the three reviewed PostgreSQL downloads", async () => {
  const knownFingerprints = [
    "618dd3173c54437d:1",
    "af39c0f818a42e41:1",
    "78905d68e9c27ba6:1",
  ]
  const reviewed = knownFingerprints.map((fingerprint) => ({
    ...finding("js/http-to-file-access", 2),
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: "scripts/provision-postgres-recovery-client.mjs",
          },
        },
      },
    ],
    partialFingerprints: { primaryLocationLineHash: fingerprint },
  }))
  await withSarif({ "reviewed.sarif": sarif(reviewed) }, async (directory) => {
    assert.deepEqual(await inspectCodeqlSarif(directory), {
      files: 1,
      findings: 3,
      blocking: 0,
      reviewedMedium: 3,
    })
  })
  for (const altered of [
    { ...reviewed[0], partialFingerprints: { primaryLocationLineHash: "new" } },
    {
      ...reviewed[0],
      locations: [
        {
          physicalLocation: { artifactLocation: { uri: "scripts/other.mjs" } },
        },
      ],
    },
    finding("medium", 1),
  ]) {
    await withSarif(
      { "new-medium.sarif": sarif([...reviewed, altered]) },
      async (directory) => {
        const result = await inspectCodeqlSarif(directory)
        assert.equal(result.blocking, 1)
        assert.equal(result.reviewedMedium, 3)
      }
    )
  }
  await withSarif(
    { "duplicate.sarif": sarif([...reviewed, reviewed[0]]) },
    async (directory) => {
      assert.equal((await inspectCodeqlSarif(directory)).blocking, 1)
    }
  )
  await withSarif({ "reviewed.sarif": sarif(reviewed) }, async (directory) => {
    const isolatedGate = join(directory, "verify-codeql-sarif.mjs")
    await copyFile(
      new URL("./verify-codeql-sarif.mjs", import.meta.url),
      isolatedGate
    )
    await writeFile(
      join(directory, "provision-postgres-recovery-client.mjs"),
      "changed"
    )
    const { inspectCodeqlSarif: inspectChangedSource } = await import(
      pathToFileURL(isolatedGate).href
    )
    const result = await inspectChangedSource(directory)
    assert.equal(result.blocking, 3)
    assert.equal(result.reviewedMedium, 0)
  })
})
