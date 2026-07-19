const pa11y = require("pa11y")

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000"
const chromeExecutablePath =
  process.env.PA11Y_CHROME_EXECUTABLE_PATH ?? process.env.CHROME_PATH
const productPath = process.env.QA_PRODUCT_PATH ?? "/products"
const extraUrls = process.env.QA_EXTRA_URLS
  ? process.env.QA_EXTRA_URLS.split(",").map((entry) => entry.trim()).filter(Boolean)
  : []
const configuredPaths = process.env.QA_PATHS
  ? process.env.QA_PATHS.split(",").map((entry) => entry.trim()).filter(Boolean)
  : []
const MAX_FRAMEWORK_ERROR_ATTEMPTS = 2

const targetPaths = Array.from(
  new Set(
    configuredPaths.length
      ? [...configuredPaths, ...extraUrls]
      : ["/", "/products", productPath, "/cart", ...extraUrls]
  )
)

const toUrl = (path) => {
  try {
    return new URL(path, baseUrl).toString()
  } catch (error) {
    throw new Error(
      `Unable to construct URL for '${path}' with base '${baseUrl}': ${error.message}`
    )
  }
}

const isFrameworkErrorDocument = (results) =>
  results.issues.some((issue) => issue.selector === "#__next_error__")

const auditTarget = async (target) => {
  for (let attempt = 1; attempt <= MAX_FRAMEWORK_ERROR_ATTEMPTS; attempt += 1) {
    const results = await pa11y(target, {
      standard: "WCAG2AA",
      runners: ["axe"],
      timeout: 30000,
      ...(chromeExecutablePath
        ? { chromeLaunchConfig: { executablePath: chromeExecutablePath } }
        : {}),
    })

    if (!isFrameworkErrorDocument(results) || attempt === MAX_FRAMEWORK_ERROR_ATTEMPTS) {
      return results
    }

    console.warn(
      `Next.js returned its transient error document for ${target}; retrying accessibility audit once.`
    )
  }

  throw new Error(`Accessibility audit did not return results for ${target}`)
}

const run = async () => {
  let hasFailures = false

  console.log("\n🌐 Accessibility audit using pa11y (axe, WCAG2AA)")
  console.log(`Base URL: ${baseUrl}`)

  for (const path of targetPaths) {
    const target = toUrl(path)
    console.log(`\n🔍 Checking ${target}`)
    try {
      const results = await auditTarget(target)

      if (results.issues.length) {
        hasFailures = true
        for (const issue of results.issues) {
          console.error(
            `❌  ${issue.type.toUpperCase()} [${issue.code}] ${issue.message}\n    Selector: ${issue.selector}\n    Context: ${issue.context}\n`
          )
        }
      } else {
        console.log("✅  No accessibility issues detected.")
      }
    } catch (error) {
      hasFailures = true
      console.error(`❌  pa11y execution failed: ${error.message}`)
    }
  }

  if (hasFailures) {
    console.error("\nAccessibility violations detected. See details above.")
    process.exit(1)
  }

  console.log("\n✨ Accessibility checks passed.")
}

run().catch((error) => {
  console.error("Unexpected pa11y error:", error)
  process.exit(1)
})
