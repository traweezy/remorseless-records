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
    include: [
      "src/app/api/{cart,checkout}/**/*.test.ts",
      "src/features/checkout/{api,components,lib,schemas,server}/**/*.test.{ts,tsx}",
      "src/lib/{cart,redis}/**/*.test.ts",
    ],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage/transactional",
      all: true,
      include: [
        "src/app/api/{cart,checkout}/**/*.ts",
        "src/features/checkout/{api,lib,schemas,server}/**/*.ts",
        "src/features/checkout/components/{checkout-error-summary,checkout-problem,checkout-summary,payment-section}.tsx",
        "src/lib/{cart,redis}/**/*.ts",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
})
