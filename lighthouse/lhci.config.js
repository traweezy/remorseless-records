const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000"
const productPath =
  process.env.QA_PRODUCT_PATH ??
  "/music-release/pathologist-pathological-decomposition"
const configuredPaths = process.env.QA_PATHS
  ? process.env.QA_PATHS.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  : []
const paths = configuredPaths.length
  ? configuredPaths
  : ["/", "/catalog", productPath, "/cart", "/checkout", "/privacy"]
const disableChromeSandbox = process.env.LHCI_CHROME_NO_SANDBOX === "1"
const configuredCpuSlowdownMultiplier = Number(
  process.env.QA_LIGHTHOUSE_CPU_SLOWDOWN ?? "4"
)
const configuredRuns = Number.parseInt(
  process.env.QA_LIGHTHOUSE_RUNS ?? "3",
  10
)
if (
  !Number.isInteger(configuredRuns) ||
  configuredRuns < 1 ||
  configuredRuns > 5
) {
  throw new Error("QA_LIGHTHOUSE_RUNS must be an integer from 1 through 5")
}
if (
  !Number.isFinite(configuredCpuSlowdownMultiplier) ||
  configuredCpuSlowdownMultiplier < 1 ||
  configuredCpuSlowdownMultiplier > 20
) {
  throw new Error(
    "QA_LIGHTHOUSE_CPU_SLOWDOWN must be a number from 1 through 20"
  )
}

const medianMaximum = (maxNumericValue) => [
  "error",
  { aggregationMethod: "median", maxNumericValue },
]
const medianMinimum = (minScore) => [
  "error",
  { aggregationMethod: "median", minScore },
]

const commonAssertions = {
  "categories:performance": medianMinimum(0.8),
  "categories:accessibility": medianMinimum(0.95),
  "categories:best-practices": medianMinimum(0.9),
  "first-contentful-paint": medianMaximum(3_000),
  "largest-contentful-paint": medianMaximum(4_500),
  "total-blocking-time": medianMaximum(350),
  "cumulative-layout-shift": medianMaximum(0.1),
  "total-byte-weight": medianMaximum(1_500_000),
  "resource-summary:script:size": medianMaximum(850_000),
  "resource-summary:script:count": medianMaximum(65),
  "resource-summary:total:count": medianMaximum(120),
}

module.exports = {
  ci: {
    collect: {
      numberOfRuns: configuredRuns,
      url: Array.from(new Set(paths)).map((path) =>
        new URL(path, baseUrl).toString()
      ),
      settings: {
        throttling: {
          cpuSlowdownMultiplier: configuredCpuSlowdownMultiplier,
        },
        ...(disableChromeSandbox
          ? {
              chromeFlags: "--no-sandbox --disable-setuid-sandbox",
            }
          : {}),
      },
    },
    assert: {
      assertMatrix: [
        {
          matchingUrlPattern: ".*",
          assertions: commonAssertions,
        },
        {
          matchingUrlPattern: "^(?!.*\\/checkout(?:$|[/?])).*$",
          assertions: {
            "categories:seo": medianMinimum(0.9),
          },
        },
      ],
    },
    upload: {
      target: "filesystem",
      outputDir:
        process.env.LHCI_OUTPUT_DIR ?? "/tmp/remorseless-lighthouse-reports",
    },
  },
}
