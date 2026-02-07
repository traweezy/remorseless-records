import js from "@eslint/js"
import nextPlugin from "@next/eslint-plugin-next"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import jsxA11y from "eslint-plugin-jsx-a11y"
import tseslint from "typescript-eslint"
import eslintConfigPrettier from "eslint-config-prettier"

const ignores = [
  "**/node_modules/**",
  ".next/**",
  "public/**",
  ".github/**",
  "e2e/**",
  "e2e/playwright-report/**",
  "scripts/**",
  "tmp/**",
  "eslint.config.mjs",
  "next-sitemap.js",
  "postcss.config.js",
  "playwright.config.ts",
  "vitest.config.ts",
  "coverage/**",
  "dist/**",
]

const typeCheckedConfigs = tseslint.configs.recommendedTypeChecked.map(
  (config) => ({
    ...config,
    languageOptions: {
      ...(config.languageOptions ?? {}),
      parserOptions: {
        ...(config.languageOptions?.parserOptions ?? {}),
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  })
)

const reactHooksRecommendedConfig =
  reactHooks.configs?.flat?.recommended ?? reactHooks.configs?.recommended

const jsxA11yRecommendedConfig =
  jsxA11y.flatConfigs?.recommended ?? jsxA11y.configs?.recommended

const sharedRules =
  reactHooks.configs?.flat?.recommended?.rules ??
  reactHooks.configs?.recommended?.rules ??
  {}

export default tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...typeCheckedConfigs,
  nextPlugin.configs.recommended,
  ...(jsxA11yRecommendedConfig ? [jsxA11yRecommendedConfig] : []),
  ...(reactHooksRecommendedConfig ? [reactHooksRecommendedConfig] : []),
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      ...sharedRules,
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": "off",
      "jsx-a11y/anchor-is-valid": [
        "warn",
        {
          aspects: ["invalidHref", "preferButton"],
        },
      ],
      "jsx-a11y/no-autofocus": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", disallowTypeAnnotations: false },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/prefer-nullish-coalescing": [
        "warn",
        { ignorePrimitives: { boolean: true } },
      ],
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/google-font-display": "error",
      "@next/next/no-sync-scripts": "error",
    },
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  eslintConfigPrettier
)
