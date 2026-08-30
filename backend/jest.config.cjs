/** @type {import('jest').Config} */
module.exports = {
  collectCoverageFrom: [
    "src/lib/{checkout,database,payment-lifecycle,refund-operations,security,tax-control,tax-reporting,uploads}/**/*.ts",
    "!src/**/*.test.ts",
    "!src/**/types.ts",
  ],
  coverageDirectory: "<rootDir>/coverage/unit",
  coverageReporters: ["text", "lcov", "html", "json-summary"],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/.medusa/", "/dist/"],
  modulePathIgnorePatterns: ["<rootDir>/.medusa/", "<rootDir>/dist/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.[cm]?[tj]sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: {
            decorators: true,
            syntax: "typescript",
            tsx: true,
          },
          transform: {
            decoratorMetadata: true,
            legacyDecorator: true,
            react: {
              runtime: "automatic",
            },
          },
        },
      },
    ],
  },
}
