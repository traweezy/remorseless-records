const unitConfig = require("./jest.config.cjs")

module.exports = {
  ...unitConfig,
  collectCoverage: false,
  coverageThreshold: undefined,
  testMatch: ["<rootDir>/integration-tests/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/.medusa/", "/dist/"],
  testTimeout: 120_000,
}
