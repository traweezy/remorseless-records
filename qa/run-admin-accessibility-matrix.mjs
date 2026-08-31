import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repositoryRoot = dirname(import.meta.dirname)
const acceptanceScript = join(
  repositoryRoot,
  "qa",
  "admin-visual-acceptance.mjs"
)
const screenshotDirectory =
  process.env.ADMIN_ACCEPTANCE_SCREENSHOT_DIR?.trim() ||
  "/tmp/remorseless-admin-accessibility"
const concurrency = Number(process.env.ADMIN_ACCEPTANCE_CONCURRENCY ?? "2")

if (!isAbsolute(screenshotDirectory)) {
  throw new TypeError("ADMIN_ACCEPTANCE_SCREENSHOT_DIR must be absolute.")
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
  throw new TypeError(
    "ADMIN_ACCEPTANCE_CONCURRENCY must be an integer from 1 through 4."
  )
}

const cases = [
  {
    height: 900,
    name: "product-create-validation-200-percent",
    route: "/app/products/create",
    setup: "catalog-create-validation",
    width: 800,
  },
  {
    height: 900,
    name: "product-create-offerings-laptop",
    route: "/app/products/create",
    setup: "catalog-create-offerings",
    width: 1440,
  },
  {
    height: 1080,
    name: "product-authoring-wide",
    route: "/app/catalog/products/product_acceptance",
    width: 1920,
  },
  {
    height: 900,
    name: "product-list-laptop",
    route: "/app/products",
    width: 1440,
  },
  {
    height: 900,
    name: "merchandising-laptop",
    route: "/app/catalog-merchandising",
    width: 1440,
  },
  {
    axeInclude: "[role=dialog]",
    click: "New shelf",
    height: 900,
    name: "merchandising-create-mobile",
    route: "/app/catalog-merchandising",
    width: 760,
  },
  {
    axeInclude: "[role=dialog]",
    click: "Create post",
    height: 900,
    name: "news-create-mobile",
    route: "/app/content/news",
    width: 760,
  },
  {
    axeInclude: "[role=dialog]",
    click: "Add historical release",
    height: 900,
    name: "discography-create-mobile",
    route: "/app/content/discography",
    width: 760,
  },
  {
    height: 900,
    name: "tax-control-laptop",
    route: "/app/settings/tax-control",
    width: 1440,
  },
  {
    height: 900,
    name: "media-cleanup-mobile",
    route: "/app/operations/media-cleanup",
    width: 760,
  },
  {
    height: 900,
    name: "refund-operations-laptop",
    route: "/app/operations/refunds",
    width: 1440,
  },
  {
    height: 1080,
    name: "tax-records-wide",
    route: "/app/operations/tax-records",
    width: 1920,
  },
]

const parseReport = (output, caseName) => {
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`Acceptance case ${caseName} returned invalid JSON.`, {
      cause: error,
    })
  }
}

const runCase = async (acceptanceCase) => {
  const screenshotPath = join(screenshotDirectory, `${acceptanceCase.name}.png`)
  const environment = {
    ...process.env,
    ADMIN_ACCEPTANCE_AXE_INCLUDE: acceptanceCase.axeInclude ?? "main",
    ADMIN_ACCEPTANCE_HEIGHT: String(acceptanceCase.height),
    ADMIN_ACCEPTANCE_ROUTE: acceptanceCase.route,
    ADMIN_ACCEPTANCE_SCREENSHOT: screenshotPath,
    ADMIN_ACCEPTANCE_WIDTH: String(acceptanceCase.width),
    ...(acceptanceCase.click
      ? { ADMIN_ACCEPTANCE_CLICK: acceptanceCase.click }
      : {}),
    ...(acceptanceCase.setup
      ? { ADMIN_ACCEPTANCE_SETUP: acceptanceCase.setup }
      : {}),
  }

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [acceptanceScript],
      {
        cwd: repositoryRoot,
        env: environment,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 90_000,
      }
    )
    return {
      case: acceptanceCase,
      report: parseReport(stdout, acceptanceCase.name),
    }
  } catch (error) {
    const stdout =
      error && typeof error === "object" && "stdout" in error
        ? String(error.stdout)
        : ""
    const report = stdout ? parseReport(stdout, acceptanceCase.name) : null
    return {
      case: acceptanceCase,
      error: error instanceof Error ? error.message : String(error),
      report,
    }
  }
}

await mkdir(screenshotDirectory, { recursive: true })

const results = []
for (let index = 0; index < cases.length; index += concurrency) {
  const batch = cases.slice(index, index + concurrency)
  results.push(...(await Promise.all(batch.map(runCase))))
}

const summary = results.map(({ case: acceptanceCase, error, report }) => ({
  axeIncomplete: report?.axe.incomplete.length ?? null,
  axeViolations: report?.axe.violations.length ?? null,
  error: error ?? null,
  findings: report?.findingCodes ?? ["report_unavailable"],
  focusTargets: report?.focusOrder.length ?? null,
  height: acceptanceCase.height,
  name: acceptanceCase.name,
  route: acceptanceCase.route,
  reviewCodes: report?.reviewCodes ?? [],
  screenshotPath: report?.screenshotPath ?? null,
  status: report?.status ?? "failed",
  width: acceptanceCase.width,
}))
const failed = summary.filter(({ status }) => status !== "passed")

console.log(
  JSON.stringify(
    {
      cases: summary,
      failed: failed.length,
      passed: summary.length - failed.length,
      screenshotDirectory,
      status: failed.length === 0 ? "passed" : "failed",
    },
    null,
    2
  )
)

if (failed.length > 0) {
  throw new Error(
    `Admin accessibility matrix failed: ${failed
      .map(({ findings, name }) => `${name} (${findings.join(", ")})`)
      .join("; ")}`
  )
}
