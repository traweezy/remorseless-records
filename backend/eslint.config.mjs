import tseslint from "typescript-eslint";

export default tseslint.config({
  ignores: [
    "dist",
    ".medusa",
    "node_modules",
    "*.js",
    "**/*.js",
    "scripts/**/*.js",
    "src/scripts/**/*.js",
    "*.config.js",
    "*.config.cjs",
    "eslint.config.js",
  ],
  files: ["**/*.ts", "**/*.tsx"],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: "./tsconfig.json",
      tsconfigRootDir: import.meta.dirname,
      sourceType: "module",
    },
    ecmaVersion: "latest",
    globals: {
      console: "readonly",
      process: "readonly",
      Buffer: "readonly",
    },
  },
  linterOptions: {
    reportUnusedDisableDirectives: "error",
  },
  rules: {
    ...tseslint.configs.recommended.rules,
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/require-await": "off",
    "@typescript-eslint/no-unnecessary-type-assertion": "off",
    "no-console": "off",
    "no-undef": "off",
    "no-unused-vars": "off",
  },
});
