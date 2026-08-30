import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { gzipSync } from "node:zlib"

const assetsDirectory =
  process.argv[2] ?? "backend/.medusa/server/public/admin/assets"

const budgets = {
  mainGzipBytes: 2_000_000,
  mainRawBytes: 8_100_000,
  totalGzipBytes: 2_650_000,
  totalRawBytes: 10_000_000,
}

const files = fs
  .readdirSync(assetsDirectory)
  .filter((file) => file.endsWith(".js"))
  .map((file) => {
    const bytes = fs.readFileSync(path.join(assetsDirectory, file))
    return {
      file,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
      rawBytes: bytes.length,
    }
  })

assert.ok(files.length > 0, "The Admin build contains no JavaScript assets")

const main = files.reduce((largest, file) =>
  file.rawBytes > largest.rawBytes ? file : largest
)
const totals = files.reduce(
  (result, file) => ({
    gzipBytes: result.gzipBytes + file.gzipBytes,
    rawBytes: result.rawBytes + file.rawBytes,
  }),
  { gzipBytes: 0, rawBytes: 0 }
)

const report = {
  budgets,
  files: files.length,
  main,
  totals,
}

console.log(JSON.stringify(report, null, 2))

assert.ok(
  main.rawBytes <= budgets.mainRawBytes,
  `Admin main bundle exceeds ${budgets.mainRawBytes} raw bytes: ${main.rawBytes}`
)
assert.ok(
  main.gzipBytes <= budgets.mainGzipBytes,
  `Admin main bundle exceeds ${budgets.mainGzipBytes} gzip bytes: ${main.gzipBytes}`
)
assert.ok(
  totals.rawBytes <= budgets.totalRawBytes,
  `Admin JavaScript exceeds ${budgets.totalRawBytes} raw bytes: ${totals.rawBytes}`
)
assert.ok(
  totals.gzipBytes <= budgets.totalGzipBytes,
  `Admin JavaScript exceeds ${budgets.totalGzipBytes} gzip bytes: ${totals.gzipBytes}`
)
