const assert = require("node:assert/strict")
const {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs")
const { tmpdir } = require("node:os")
const { join } = require("node:path")
const { test } = require("node:test")

const { rewriteRuntimeAliases } = require("./rewrite-runtime-aliases")

const fixture = (work) => {
  const server = mkdtempSync(join(tmpdir(), "rr-runtime-aliases-"))
  try {
    mkdirSync(join(server, "src", "api"), { recursive: true })
    mkdirSync(join(server, "src", "modules", "catalog"), {
      recursive: true,
    })
    writeFileSync(
      join(server, "src", "modules", "catalog", "serializers.js"),
      "module.exports = { ready: true }\n"
    )
    return work(server)
  } finally {
    rmSync(server, { recursive: true, force: true })
  }
}

test("rewrites compiled aliases to loadable relative files", () =>
  fixture((server) => {
    const route = join(server, "src", "api", "route.js")
    writeFileSync(
      route,
      'module.exports = require("@/modules/catalog/serializers")\n'
    )
    assert.deepEqual(rewriteRuntimeAliases(server), { files: 2, aliases: 1 })
    assert.match(
      readFileSync(route, "utf8"),
      /require\("\.\.\/modules\/catalog\/serializers\.js"\)/u
    )
    assert.deepEqual(require(route), { ready: true })
    assert.deepEqual(rewriteRuntimeAliases(server), { files: 2, aliases: 0 })
  }))

test("rejects missing targets before changing any compiled file", () =>
  fixture((server) => {
    const good = join(server, "src", "api", "a.js")
    const bad = join(server, "src", "api", "b.js")
    const original = 'require("@/modules/catalog/serializers")\n'
    writeFileSync(good, original)
    writeFileSync(bad, 'require("@/modules/missing")\n')
    assert.throws(
      () => rewriteRuntimeAliases(server),
      /no compiled JavaScript/u
    )
    assert.equal(readFileSync(good, "utf8"), original)
  }))

test("rejects traversal, dynamic aliases and symbolic-link targets", () =>
  fixture((server) => {
    const route = join(server, "src", "api", "route.js")
    writeFileSync(route, 'require("@/../secrets")\n')
    assert.throws(() => rewriteRuntimeAliases(server), /traversing/u)

    writeFileSync(route, "require(`@/${name}`)\n")
    assert.throws(() => rewriteRuntimeAliases(server), /Dynamic or unresolved/u)

    const link = join(server, "src", "api", "linked.js")
    symlinkSync(route, link)
    writeFileSync(route, 'require("@/modules/catalog/serializers")\n')
    assert.throws(() => rewriteRuntimeAliases(server), /symbolic link/u)
  }))
