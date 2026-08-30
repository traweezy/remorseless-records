import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const rootRequire = createRequire(import.meta.url)
const BROWSER_MANAGER_VERSION = "3.0.6"
const workspaceFiles = [
  "pnpm-workspace.yaml",
  "backend/pnpm-workspace.yaml",
  "storefront/pnpm-workspace.yaml",
]
const requiredBrowserApi = [
  "Browser",
  "CDP_WEBSOCKET_ENDPOINT_REGEX",
  "CLI",
  "ChromeReleaseChannel",
  "TimeoutError",
  "WEBDRIVER_BIDI_WEBSOCKET_ENDPOINT_REGEX",
  "computeExecutablePath",
  "computeSystemExecutablePath",
  "createProfile",
  "detectBrowserPlatform",
  "getInstalledBrowsers",
  "install",
  "launch",
  "resolveBuildId",
  "resolveDefaultUserDataDir",
  "uninstall",
]

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"))

const browserManagerFrom = async (consumerPackagePath) => {
  const consumerRequire = createRequire(consumerPackagePath)
  const browserEntryPath = consumerRequire.resolve("@puppeteer/browsers")
  const browserPackagePath = join(
    dirname(browserEntryPath),
    "..",
    "package.json"
  )
  const browserPackage = await readJson(browserPackagePath)
  const browserApi = consumerRequire("@puppeteer/browsers")

  assert.equal(browserPackage.name, "@puppeteer/browsers")
  assert.equal(browserPackage.version, BROWSER_MANAGER_VERSION)
  assert.equal(
    Object.hasOwn(browserPackage.dependencies ?? {}, "extract-zip"),
    false,
    `${consumerPackagePath} must resolve the archive-safe browser manager`
  )

  for (const exportName of requiredBrowserApi) {
    assert.ok(
      exportName in browserApi,
      `Browser manager ${BROWSER_MANAGER_VERSION} is missing ${exportName}`
    )
  }

  return browserEntryPath
}

const packageJson = await readJson(join(repositoryRoot, "package.json"))
const pnpmLock = await readFile(join(repositoryRoot, "pnpm-lock.yaml"), "utf8")
const pnpmWorkspace = await readFile(
  join(repositoryRoot, "pnpm-workspace.yaml"),
  "utf8"
)

assert.equal(packageJson.devDependencies?.["extract-zip"], undefined)
assert.equal(
  packageJson.devDependencies?.["proxy-agent"],
  "8.0.2",
  "Browser manager proxy support must use its reviewed compatible peer"
)
assert.equal(packageJson.scripts?.["qa:extract-zip-security"], undefined)
assert.equal(
  packageJson.scripts?.["qa:browser-toolchain-security"],
  "node scripts/verify-browser-toolchain-security.mjs"
)
assert.match(pnpmWorkspace, /^  "@puppeteer\/browsers@<3\.0\.0": 3\.0\.6$/mu)
assert.match(
  pnpmWorkspace,
  /^  "puppeteer-core@>=24\.43\.1 <26\.0\.0":\n    dependencies:\n      proxy-agent: 8\.0\.2$/mu
)
assert.doesNotMatch(pnpmWorkspace, /patches\/extract-zip/u)
assert.doesNotMatch(pnpmLock, /extract-zip@/u)
assert.doesNotMatch(
  pnpmLock,
  /^  ["']?@puppeteer\/browsers@2\./mu,
  "The lockfile must not contain the vulnerable browser manager"
)
assert.doesNotMatch(
  pnpmLock,
  /^  ["']?@puppeteer\/browsers@3\.0\.6\(proxy-agent@6\./mu,
  "The reviewed browser manager must not resolve the legacy proxy peer"
)
assert.match(
  pnpmLock,
  /^  ["']?@puppeteer\/browsers@3\.0\.6["']?:$/mu,
  "The lockfile must contain the reviewed browser manager package"
)

for (const relativePath of workspaceFiles) {
  const contents = await readFile(join(repositoryRoot, relativePath), "utf8")
  assert.match(
    contents,
    /^  puppeteer: false$/mu,
    `${relativePath} must explicitly block Puppeteer install scripts`
  )
}

const pa11yPackagePath = rootRequire.resolve("pa11y/package.json")
const pa11yRequire = createRequire(pa11yPackagePath)
const pa11yPuppeteerPath = pa11yRequire.resolve("puppeteer/package.json")
const lighthouseCiPackagePath = rootRequire.resolve("@lhci/cli/package.json")
const lighthouseCiRequire = createRequire(lighthouseCiPackagePath)
const lighthousePackagePath = lighthouseCiRequire.resolve(
  "lighthouse/package.json"
)
const lighthouseRequire = createRequire(lighthousePackagePath)
const lighthousePuppeteerPath = lighthouseRequire.resolve(
  "puppeteer-core/package.json"
)

const browserEntries = await Promise.all([
  browserManagerFrom(pa11yPuppeteerPath),
  browserManagerFrom(lighthousePuppeteerPath),
])

assert.equal(
  new Set(browserEntries).size,
  1,
  "Pa11y and Lighthouse must share one reviewed browser-manager instance"
)
assert.equal(typeof rootRequire("pa11y"), "function")
assert.equal(
  typeof createRequire(pa11yPuppeteerPath)("puppeteer").launch,
  "function"
)
assert.equal(
  typeof createRequire(lighthousePuppeteerPath)("puppeteer-core").launch,
  "function"
)

console.log(
  `Browser QA toolchain verified: Pa11y and Lighthouse use @puppeteer/browsers ${BROWSER_MANAGER_VERSION} without extract-zip.`
)
