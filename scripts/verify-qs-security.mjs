import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"

const rootDirectory = process.cwd()
const projects = ["backend/package.json", "storefront/package.json"]
const patchPaths = [
  "patches/qs@6.15.3.patch",
  "backend/patches/qs@6.15.3.patch",
  "storefront/patches/qs@6.15.3.patch",
]

const patchSources = patchPaths.map((patchPath) =>
  readFileSync(path.join(rootDirectory, patchPath), "utf8")
)
assert.equal(new Set(patchSources).size, 1)

const loadQs = (projectPackagePath) => {
  const projectRequire = createRequire(
    path.join(rootDirectory, projectPackagePath)
  )
  const sdkRequire = createRequire(projectRequire.resolve("@medusajs/js-sdk"))
  const qsPackagePath = sdkRequire.resolve("qs/package.json")
  const qsRequire = createRequire(qsPackagePath)

  return {
    packagePath: qsPackagePath,
    packageVersion: qsRequire("./package.json").version,
    qs: qsRequire("./"),
  }
}

const installations = projects.map(loadQs)
assert.equal(
  new Set(installations.map(({ packagePath }) => packagePath)).size,
  1
)

for (const { packageVersion, qs } of installations) {
  assert.equal(packageVersion, "6.15.3")

  const boundedOptions = {
    arrayLimit: 3,
    comma: true,
    throwOnLimitExceeded: true,
  }
  assert.throws(
    () => qs.parse("a[]=1,2,3,4", boundedOptions),
    new RangeError("Array limit exceeded. Only 3 elements allowed in an array.")
  )
  assert.throws(
    () => qs.parse("a[b][]=1,2,3,4", boundedOptions),
    new RangeError("Array limit exceeded. Only 3 elements allowed in an array.")
  )
  assert.deepEqual(qs.parse("a[]=1,2,3", boundedOptions), {
    a: [["1", "2", "3"]],
  })

  const attack = "x%5Bconstructor%5D%5BisBuffer%5D=y"
  const plainObjectResult = qs.parse(attack, { plainObjects: true })
  assert.doesNotThrow(() => qs.stringify(plainObjectResult))
  assert.equal(qs.stringify(plainObjectResult), attack)

  const prototypeResult = qs.parse(attack, { allowPrototypes: true })
  assert.doesNotThrow(() => qs.stringify(prototypeResult))
  assert.equal(qs.stringify(prototypeResult), attack)
  assert.equal(qs.stringify({ data: Buffer.from("abc") }), "data=abc")
}

console.info(
  "qs 6.15.3 security backports verified through Backend and Storefront dependency paths."
)
