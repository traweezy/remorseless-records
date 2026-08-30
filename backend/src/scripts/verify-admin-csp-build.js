const fs = require("fs")
const path = require("path")

const ALIASED_EMPTY_FUNCTION_PATTERN =
  /const\s+[$\w]+\s*=\s*Function\s*;\s*(?:return\s+)?new\s+[$\w]+\(\s*["']{2}\s*\)/g
const DIRECT_EMPTY_FUNCTION_PATTERN =
  /(?:new\s+Function|Function)\s*\(\s*["']{2}\s*\)/g

const countAdminEvalCapabilityProbes = (source) =>
  (source.match(ALIASED_EMPTY_FUNCTION_PATTERN)?.length ?? 0) +
  (source.match(DIRECT_EMPTY_FUNCTION_PATTERN)?.length ?? 0)

const verifyAdminCspBuild = (adminAssetsDirectory) => {
  const indexAssets = fs
    .readdirSync(adminAssetsDirectory, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && /^index-[A-Za-z\d_-]+\.js$/.test(entry.name)
    )
    .map((entry) => path.join(adminAssetsDirectory, entry.name))

  if (indexAssets.length !== 1) {
    throw new Error(
      `Expected one built Admin index asset; found ${indexAssets.length}.`
    )
  }

  const source = fs.readFileSync(indexAssets[0], "utf8")
  const evalCapabilityProbes = countAdminEvalCapabilityProbes(source)
  if (evalCapabilityProbes !== 0) {
    throw new Error(
      `Built Admin index contains ${evalCapabilityProbes} eval capability probes.`
    )
  }

  return { assetPath: indexAssets[0], evalCapabilityProbes }
}

if (require.main === module) {
  const adminAssetsDirectory = path.join(
    process.cwd(),
    ".medusa",
    "server",
    "public",
    "admin",
    "assets"
  )
  const result = verifyAdminCspBuild(adminAssetsDirectory)
  console.log(
    `Admin CSP bundle verified without eval capability probes: ${path.basename(result.assetPath)}`
  )
}

module.exports = { countAdminEvalCapabilityProbes, verifyAdminCspBuild }
