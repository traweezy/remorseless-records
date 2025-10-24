const pa11y = require("pa11y")

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000"
const productPath = process.env.QA_PRODUCT_PATH ?? "/products"
const extraUrls = process.env.QA_EXTRA_URLS
  ? process.env.QA_EXTRA_URLS.split(",").map((entry) => entry.trim()).filter(Boolean)
  : []

const targetPaths = Array.from(
  new Set([
    "/",
    "/products",
    productPath,
    "/cart",
    ...extraUrls,
  ])
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

const run = async () => {
  let hasFailures = false

  console.log("\n🌐 Accessibility audit using pa11y (axe, WCAG2AA)")
  console.log(`Base URL: ${baseUrl}`)

  for (const path of targetPaths) {
    const target = toUrl(path)
    console.log(`\n🔍 Checking ${target}`)
    try {
      const results = await pa11y(target, {
        standard: "WCAG2AA",
        runners: ["axe"],
        timeout: 30000,
      })

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
