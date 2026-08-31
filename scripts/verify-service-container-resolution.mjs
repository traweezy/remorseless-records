import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const backendRequire = createRequire(path.resolve("backend/package.json"))
const ts = backendRequire("typescript")

const sourceRoot = path.resolve("backend/src")
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

const violations = []
const sourceFiles = collectSourceFiles(sourceRoot)
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
      let expression = node.expression
      while (ts.isParenthesizedExpression(expression)) {
        expression = expression.expression
      }
      if (
        ts.isCallExpression(expression) &&
        ts.isPropertyAccessExpression(expression.expression) &&
        expression.expression.name.text === "resolve"
      ) {
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
    `Post-resolution service assertions are forbidden; declare the resolver result type instead: ${violations.join(", ")}`
  )
}

console.log(
  `Service-container resolution verified: ${sourceFiles.length} production files use typed resolver contracts without post-resolution assertions.`
)
