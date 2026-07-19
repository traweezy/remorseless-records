const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000"
const productPath = process.env.QA_PRODUCT_PATH ?? "/products"
const configuredPaths = process.env.QA_PATHS
  ? process.env.QA_PATHS.split(",").map((entry) => entry.trim()).filter(Boolean)
  : []
const paths = configuredPaths.length
  ? configuredPaths
  : ["/", "/products", productPath, "/cart"]

module.exports = {
  ci: {
    collect: {
      numberOfRuns: 1,
      url: paths.map((path) => new URL(path, baseUrl).toString()),
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.85 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
        "categories:seo": ["warn", { minScore: 0.9 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
}
