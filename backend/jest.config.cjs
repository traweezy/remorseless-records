/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/.medusa/', '/dist/'],
  modulePathIgnorePatterns: ['<rootDir>/.medusa/', '<rootDir>/dist/'],
  transform: {
    '^.+\\.[cm]?[tj]sx?$': ['@swc/jest'],
  },
}
