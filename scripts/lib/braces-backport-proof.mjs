import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { lstat, readdir, readFile, realpath } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { bracesBackport, verifyBracesBackport } from "./braces-backport.mjs"
import { bracesRegression } from "./braces-backport-regression.mjs"

export const assertBackportWindow = (time) => {
  assert.ok(Number.isFinite(time))
  assert.ok(time >= Date.parse(bracesBackport.approvedAt))
  assert.ok(
    time < Date.parse(bracesBackport.expiresAt),
    "Braces exception expired"
  )
}

// Walk physical package manifests, including nested stores; do not trust the
// scanner's potentially deduplicated list to identify every installed copy.
// Callers provide only installed trees or /app, never a whole user workspace.
export const collectBracesProof = async (roots, base, now = Date.now) => {
  const startedAt = new Date(now()).toISOString()
  assertBackportWindow(Date.parse(startedAt))
  assert.equal(await realpath(base), resolve(base))
  const paths = new Set()
  const links = new Set()
  let entries = 0
  const pending = roots.map((root) => [resolve(root), 0])
  const inside = (path) => {
    const name = relative(base, path)
    assert.ok(name && !name.startsWith("../") && !name.startsWith("/"))
    return name
  }
  while (pending.length) {
    const [directory, depth] = pending.pop()
    assert.ok(depth < 100)
    const info = await lstat(directory)
    assert.ok(info.isDirectory() && !info.isSymbolicLink())
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.ok(++entries <= 1_000_000)
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        if (entry.name === "braces") links.add(await realpath(path))
        assert.notEqual(entry.name, "package.json", "Linked package manifest")
      } else if (entry.isDirectory()) pending.push([path, depth + 1])
      else if (entry.name === "package.json") {
        assert.ok(entry.isFile())
        const stat = await lstat(path)
        assert.ok(stat.size > 0 && stat.size <= 2 * 1024 * 1024)
        const manifest = JSON.parse(await readFile(path, "utf8"))
        if (manifest.name === "braces") {
          assert.equal(manifest.version, bracesBackport.version)
          inside(directory)
          paths.add(directory)
        }
      }
    }
  }
  for (const path of links) {
    inside(path)
    assert.ok(paths.has(path), "Braces link escapes inventoried package trees")
  }
  assert.ok(paths.size > 0 && paths.size <= 32)
  const packages = []
  for (const path of [...paths].sort()) {
    await verifyBracesBackport(path)
    const result = execFileSync(
      process.execPath,
      [
        "--max-old-space-size=64",
        "-e",
        bracesRegression,
        join(path, "index.js"),
      ],
      {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 16384,
        env: {
          PATH: process.env.PATH,
          LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH ?? "",
          NODE_OPTIONS: "",
          NODE_PATH: "",
        },
      }
    )
    assert.equal(
      result.trim(),
      "bounded nesting; ordinary glob and existing limits preserved"
    )
    await verifyBracesBackport(path)
    packages.push({
      path: inside(join(path, "package.json")),
      files: bracesBackport.files,
      regression: "bounded-nesting-v1",
    })
  }
  const completedAt = new Date(now()).toISOString()
  assertBackportWindow(Date.parse(completedAt))
  return {
    advisory: bracesBackport.advisory,
    version: bracesBackport.version,
    patchSha256: bracesBackport.patchSha256,
    expiresAt: bracesBackport.expiresAt,
    startedAt,
    completedAt,
    packages,
  }
}

export const validateBracesProof = (proof, start, end) => {
  assertBackportWindow(Date.parse(end))
  assert.deepEqual(
    Object.keys(proof).sort(),
    [
      "advisory",
      "version",
      "patchSha256",
      "expiresAt",
      "startedAt",
      "completedAt",
      "packages",
    ].sort()
  )
  for (const field of ["advisory", "version", "patchSha256", "expiresAt"])
    assert.equal(proof[field], bracesBackport[field])
  assert.ok(Date.parse(start) <= Date.parse(proof.startedAt))
  assert.ok(Date.parse(proof.startedAt) <= Date.parse(proof.completedAt))
  assert.ok(Date.parse(proof.completedAt) <= Date.parse(end))
  assert.ok(
    Array.isArray(proof.packages) &&
      proof.packages.length > 0 &&
      proof.packages.length <= 32
  )
  const paths = []
  for (const item of proof.packages) {
    assert.deepEqual(Object.keys(item).sort(), ["files", "path", "regression"])
    assert.match(item.path, /^(?:[a-zA-Z0-9@+_.=-]+\/)+package\.json$/u)
    assert.ok(
      !item.path.split("/").some((part) => part === ".." || part === ".")
    )
    assert.deepEqual(item.files, bracesBackport.files)
    assert.equal(item.regression, "bounded-nesting-v1")
    paths.push(item.path)
  }
  assert.deepEqual(paths, [...new Set(paths)].sort())
  return paths
}

export const exactBracesFinding = (result, finding) =>
  result.Class === "lang-pkgs" &&
  ["node-pkg", "pnpm"].includes(result.Type) &&
  finding.VulnerabilityID === bracesBackport.advisory &&
  finding.PkgName === bracesBackport.package &&
  finding.InstalledVersion === bracesBackport.version &&
  finding.Severity === "HIGH" &&
  !finding.FixedVersion

// Never change scanner counts. The separate accepted-backport count can only
// remove this exact identity from the blocking set after all-copy proof.
export const countBracesExceptions = (
  report,
  proof,
  start,
  end,
  image = false
) => {
  if (proof === null) return 0
  const paths = validateBracesProof(proof, start, end)
  let count = 0
  for (const result of report.Results) {
    for (const finding of result.Vulnerabilities ?? []) {
      if (!exactBracesFinding(result, finding)) continue
      if (image) {
        assert.equal(result.Type, "node-pkg")
        assert.equal(finding.PkgIdentifier?.PURL, "pkg:npm/braces@3.0.3")
        assert.ok(paths.includes(finding.PkgPath))
      } else assert.equal(result.Target, "pnpm-lock.yaml")
      count++
    }
  }
  return count
}
