import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage/unit",
      all: true,
      include: [
        "src/lib/money.ts",
        "src/lib/ui/cn.ts",
        "src/lib/products/stock.ts",
        "src/lib/products/categories.ts",
        "src/lib/products/slug.ts",
        "src/lib/news/rich-text.ts",
        "src/lib/search/normalize.ts",
        "src/lib/search/enrich.ts",
      ],
      thresholds: {
        lines: 99,
        statements: 99,
        functions: 99,
        branches: 94,
      },
    },
  },
})
