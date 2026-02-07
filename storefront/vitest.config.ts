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
        "src/config/**/*.ts",
        "src/hooks/**/*.ts",
        "src/lib/**/*.ts",
        "src/components/ui/smart-link.tsx",
      ],
      exclude: [
        "src/lib/cart/**",
        "src/lib/medusa.ts",
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 93,
        branches: 85,
      },
    },
  },
})
