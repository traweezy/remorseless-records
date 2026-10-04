import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const directory = new URL("public/fonts/", root)
const manifest = JSON.parse(
  await readFile(new URL("sources.json", directory), "utf8")
)
const css = await readFile(new URL("src/styles/fonts.css", root), "utf8")
const stripeCss = await readFile(
  new URL("public/fonts/stripe-inter.css", root),
  "utf8"
)
const interFaces = css.match(
  /@font-face \{\n  font-family: "Inter";[\s\S]*?\n\}/gu
)
assert.equal(interFaces?.length, 7)
assert.equal(
  stripeCss.trim(),
  [
    "/* Stripe Elements: the same vendored Inter faces as the Storefront. */",
    ...interFaces.map((face) => face.replaceAll("url(/fonts/", "url(./")),
  ].join("\n\n")
)
const layout = await readFile(new URL("src/app/layout.tsx", root), "utf8")
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const files = new Set()

assert.equal(manifest.license, "SIL Open Font License 1.1")
assert.deepEqual(
  manifest.families.map(({ family }) => family),
  ["Bebas Neue", "Teko", "Inter", "JetBrains Mono"]
)
for (const family of manifest.families) {
  assert.match(family.sourceCommit, /^[a-f0-9]{40}$/u)
  assert.equal(new URL(family.cssUrl).origin, "https://fonts.googleapis.com")
  assert.equal(
    family.licenseUrl,
    `https://raw.githubusercontent.com/google/fonts/${family.sourceCommit}/ofl/${family.slug}/OFL.txt`
  )
  assert.equal(family.licenseFile, `${family.slug}-OFL.txt`)
  const license = await readFile(new URL(family.licenseFile, directory))
  assert.equal(digest(license), family.licenseSha256)
  assert.match(license.toString("utf8"), /SIL OPEN FONT LICENSE Version 1\.1/u)
  for (const asset of family.files) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/u)
    assert.equal(
      asset.file,
      `${family.slug}-${asset.sha256.slice(0, 16)}.woff2`
    )
    assert.equal(new URL(asset.url).origin, "https://fonts.gstatic.com")
    assert.equal(files.has(asset.file), false)
    files.add(asset.file)
    const bytes = await readFile(new URL(asset.file, directory))
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "wOF2")
    assert.equal(bytes.length, asset.bytes)
    assert.equal(digest(bytes), asset.sha256)
    assert.ok(css.includes(`/fonts/${asset.file}`))
  }
}
assert.equal(files.size, 18)
assert.deepEqual(
  (await readdir(directory)).filter((file) => file.endsWith(".woff2")).sort(),
  [...files].sort()
)
assert.doesNotMatch(css, /https?:|@import/u)
const cssFiles = new Set(
  [...css.matchAll(/url\(["']?\/fonts\/([^)'"\s]+)/gu)].map((match) => match[1])
)
assert.deepEqual([...cssFiles].sort(), [...files].sort())
assert.equal(new Set(manifest.preloads).size, 4)
for (const preload of manifest.preloads) {
  assert.ok(preload.startsWith("/fonts/") && files.has(preload.slice(7)))
}
assert.doesNotMatch(layout, /next\/font\/google/u)
assert.ok(layout.includes("@/styles/fonts.css"))
assert.ok(
  layout.includes('import fontSources from "../../public/fonts/sources.json"')
)
assert.ok(layout.includes("Array.from(fontSources.preloads).map("))
console.log(
  `Verified ${files.size} licensed local fonts and four preloads in ${fileURLToPath(directory)}`
)
