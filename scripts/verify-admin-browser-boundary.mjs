import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const backendRequire = createRequire(path.resolve("backend/package.json"))
const ts = backendRequire("typescript")

const backendTsconfigPath = path.resolve("backend/tsconfig.json")
const adminSourceRoot = path.resolve("backend/src/admin")
const sourceExtensions = new Set([".ts", ".tsx"])
const excludedSuffixes = [".spec.ts", ".spec.tsx", ".test.ts", ".test.tsx"]

const collectSourceFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return collectSourceFiles(absolutePath)
    }
    if (
      !entry.isFile() ||
      !sourceExtensions.has(path.extname(entry.name)) ||
      excludedSuffixes.some((suffix) => entry.name.endsWith(suffix))
    ) {
      return []
    }
    return [absolutePath]
  })

const unwrappedExpression = (node) => {
  let expression = node
  while (
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression
  }
  return expression
}

const isBrowserBoundaryAssertion = (node) => {
  let expression = unwrappedExpression(node)
  while (
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    if (
      ts.isPropertyAccessExpression(expression) &&
      (expression.name.text === "current" ||
        expression.name.text === "currentTarget")
    ) {
      return true
    }
    expression = unwrappedExpression(expression.expression)
  }
  return ts.isIdentifier(expression) && expression.text === "globalThis"
}

const tsconfig = JSON.parse(fs.readFileSync(backendTsconfigPath, "utf8"))
const configuredLibraries = new Set(
  (tsconfig.compilerOptions?.lib ?? []).map((library) => library.toLowerCase())
)
const missingLibraries = ["dom", "dom.iterable"].filter(
  (library) => !configuredLibraries.has(library)
)
if (missingLibraries.length) {
  throw new Error(
    `The Medusa Dashboard compiler must include browser libraries: ${missingLibraries.join(", ")}`
  )
}

const sourceFiles = collectSourceFiles(adminSourceRoot)
const violations = []
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8")
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const visit = (node) => {
    if (ts.isAsExpression(node)) {
      const assertedExpression = unwrappedExpression(node.expression)
      const isDoubleAssertion =
        ts.isAsExpression(node.expression) ||
        (ts.isParenthesizedExpression(node.expression) &&
          ts.isAsExpression(node.expression.expression))
      if (isDoubleAssertion || isBrowserBoundaryAssertion(assertedExpression)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart()
        )
        violations.push(`${path.relative(process.cwd(), file)}:${line + 1}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

if (violations.length) {
  throw new Error(
    `Dashboard browser values must use native DOM types without assertion bridges: ${violations.join(", ")}`
  )
}

console.log(
  `Dashboard browser boundary verified: ${sourceFiles.length} production files use native DOM types without assertion bridges.`
)
