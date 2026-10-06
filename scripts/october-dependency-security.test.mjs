import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { once } from "node:events"
import { createServer, get } from "node:http"
import { createRequire } from "node:module"
import { test } from "node:test"
import zlib from "node:zlib"

const rootRequire = createRequire(new URL("../package.json", import.meta.url))
const backendRequire = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const storefrontRequire = createRequire(
  new URL("../storefront/package.json", import.meta.url)
)
const through = (require, names) =>
  names.reduce((parent, name) => createRequire(parent.resolve(name)), require)
const medusaRequire = through(backendRequire, ["@medusajs/framework"])
const migrationRequire = through(medusaRequire, [
  "@mikro-orm/migrations",
  "umzug",
])

test("legacy YAML CLI and migration command parameters survive removing sprintf", async () => {
  const yamlRequire = through(rootRequire, [
    "@lhci/cli/package.json",
    "js-yaml",
  ])
  assert.throws(
    () => through(yamlRequire, ["argparse"]).resolve("sprintf-js"),
    {
      code: "MODULE_NOT_FOUND",
    }
  )
  // Resolve the actual package CLI instead of a hoisted parser substitute.
  const manifest = yamlRequire.resolve("./package.json")
  const cliPath = new URL("./bin/js-yaml.js", `file://${manifest}`).pathname
  const yaml = execFileSync(process.execPath, [cliPath], {
    input: "name: records\nquantity: 2\n",
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 16_384,
  })
  assert.deepEqual(JSON.parse(yaml), { name: "records", quantity: 2 })
  const version = execFileSync(process.execPath, [cliPath, "--version"], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 16_384,
  })
  assert.equal(version.trim(), "3.15.2")
  const { ArgumentParser } = yamlRequire("argparse")
  const formatParser = new ArgumentParser({ prog: "fixture", addHelp: false })
  formatParser.addArgument("--count", {
    defaultValue: 2,
    help: "Count %(defaultValue)s for %(prog)s",
  })
  formatParser.addArgument("--precision", {
    defaultValue: 1.25,
    help: "%(defaultValue).1000000000f",
  })
  assert.match(formatParser.formatHelp(), /Count 2 for fixture/u)
  assert.match(formatParser.formatHelp(), /defaultValue\).1000000000f/u)
  const { CommandLineParser, CommandLineAction } = migrationRequire(
    "@rushstack/ts-command-line"
  )
  class Action extends CommandLineAction {
    constructor() {
      super({
        actionName: "inspect",
        summary: "Inspect fixture",
        documentation: "Read only fixture command",
      })
    }
    onDefineParameters() {
      this.name = this.defineStringParameter({
        parameterLongName: "--name",
        argumentName: "NAME",
        description: "Fixture name",
        required: true,
      })
      this.verbose = this.defineFlagParameter({
        parameterLongName: "--verbose",
        description: "Detailed fixture output",
      })
    }
    async onExecute() {
      this.observed = { name: this.name.value, verbose: this.verbose.value }
    }
  }
  const parser = new CommandLineParser({
    toolFilename: "fixture",
    toolDescription: "Migration argument compatibility",
  })
  const action = new Action()
  parser.addAction(action)
  await parser.executeWithoutErrorHandlingAsync([
    "inspect",
    "--name",
    "records",
    "--verbose",
  ])
  assert.deepEqual(action.observed, { name: "records", verbose: true })
  assert.match(action.renderHelpText(), /--name NAME/u)
  assert.match(parser.renderHelpText(), /inspect/u)
})

test("Express proxy trust never promotes native IPv6 prefixes to IPv4 trust", () => {
  const proxy = through(medusaRequire, ["express"])("proxy-addr")
  for (const prefix of ["::1/1", "::ffff:0.0.0.0/32", "::ffff:127.0.0.1/80"]) {
    const trust = proxy.compile(prefix)
    assert.equal(trust("203.0.113.8"), false)
    assert.equal(trust("::ffff:203.0.113.8"), false)
  }
  const local = proxy.compile(["127.0.0.0/8", "::ffff:10.0.0.0/104"])
  assert.equal(local("::ffff:127.0.0.1"), true)
  assert.equal(local("10.1.2.3"), true)
  assert.equal(local("::ffff:10.1.2.3"), true)
  assert.equal(local("::1"), false)
  assert.equal(local("203.0.113.8"), false)
})

test("aborted compressed HTTP responses close their native gzip handle", {
  timeout: 10_000,
}, async () => {
  const compression = medusaRequire("compression")({ threshold: 0 })
  const descriptor = Object.getOwnPropertyDescriptor(zlib, "createGzip")
  const streams = []
  Object.defineProperty(zlib, "createGzip", {
    ...descriptor,
    value: (...args) => {
      const stream = descriptor.value(...args)
      streams.push(stream)
      return stream
    },
  })
  const server = createServer((req, res) =>
    compression(req, res, () => {
      res.setHeader("Content-Type", "text/plain")
      res.write("records ".repeat(1_024))
      res.flush()
    })
  )
  try {
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    await new Promise((resolve, reject) => {
      const req = get(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          headers: { "Accept-Encoding": "gzip" },
        },
        (res) => {
          res.once("data", () => {
            res.destroy()
            resolve()
          })
          res.on("error", () => {})
        }
      )
      req.on("error", reject)
      req.setTimeout(2_000, () =>
        req.destroy(new Error("Fixture response timeout"))
      )
    })
    assert.equal(streams.length, 1)
    if (!streams[0].closed)
      await once(streams[0], "close", { signal: AbortSignal.timeout(2_000) })
    assert.equal(streams[0].destroyed, true)
    assert.equal(streams[0].closed, true)
  } finally {
    Object.defineProperty(zlib, "createGzip", descriptor)
    for (const stream of streams) stream.destroy()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("GraphQL schema tooling rejects prototype keys and keeps query generation", async () => {
  const codegenRequire = through(medusaRequire, [
    "@medusajs/utils",
    "@graphql-codegen/core",
  ])
  for (const require of [
    codegenRequire,
    through(codegenRequire, ["@graphql-tools/schema"]),
  ]) {
    const { mergeDeep } = require("@graphql-tools/utils")
    const merged = mergeDeep([
      {},
      JSON.parse(
        '{"__proto__":{"auditPolluted":true},"constructor":{"prototype":{"auditPolluted":true}},"prototype":{"auditPolluted":true},"safe":{"limit":2}}'
      ),
    ])
    assert.deepEqual(merged, { safe: { limit: 2 } })
    assert.equal(Object.prototype.auditPolluted, undefined)
    assert.equal(Object.getPrototypeOf(merged), Object.prototype)
  }
  const { makeExecutableSchema } = codegenRequire("@graphql-tools/schema")
  const { graphql } = codegenRequire("graphql")
  const schema = makeExecutableSchema({
    typeDefs: "type Query { record: String! }",
    resolvers: { Query: { record: () => "Remorseless" } },
  })
  const result = await graphql({ schema, source: "{ record }" })
  assert.equal(result.errors, undefined)
  assert.equal(result.data.record, "Remorseless")
})

test("Tailwind selector parsing handles large flat selectors within a bounded child", () => {
  const parserPath = through(storefrontRequire, ["tailwindcss"]).resolve(
    "postcss-selector-parser"
  )
  execFileSync(
    process.execPath,
    [
      "--max-old-space-size=128",
      "-e",
      `
const assert = require('node:assert/strict'); const parser = require(process.argv[1]);
const value = '.a'.repeat(50000); const root = parser().astSync(value);
assert.equal(root.first.nodes.length, 50000); assert.equal(root.toString(), value);
assert.equal(parser().processSync('.a:is(.b,.c) > [data-size="M"]'), '.a:is(.b,.c) > [data-size="M"]');
`,
      parserPath,
    ],
    { timeout: 5_000, maxBuffer: 16_384, stdio: ["ignore", "pipe", "pipe"] }
  )
})

test("PostCSS source maps reject oversized, invalid and cumulative indexed offsets", () => {
  const { SourceMapConsumer, SourceMapGenerator } = through(storefrontRequire, [
    "postcss",
  ])("source-map-js")
  const flat = {
    version: 3,
    sources: ["record.css"],
    names: [],
    mappings: "AAAA",
  }
  const indexed = (line, map = flat, column = 0) => ({
    version: 3,
    sections: [{ offset: { line, column }, map }],
  })
  for (const offset of [
    -1,
    0.5,
    "1",
    NaN,
    Infinity,
    10_000_001,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(() => new SourceMapConsumer(indexed(offset)), /offset/u)
  }
  for (const column of [-1, 0.5, "1", Infinity]) {
    assert.throws(
      () => new SourceMapConsumer(indexed(0, flat, column)),
      /offset/u
    )
  }
  assert.throws(
    () => new SourceMapConsumer(indexed(6_000_000, indexed(6_000_000))),
    /nested sections/u
  )
  const consumer = new SourceMapConsumer(indexed(2))
  assert.deepEqual(consumer.originalPositionFor({ line: 3, column: 1 }), {
    source: "record.css",
    line: 1,
    column: 0,
    name: null,
  })
  const generated = SourceMapGenerator.fromSourceMap(
    new SourceMapConsumer(flat)
  ).toJSON()
  assert.equal(generated.mappings, "AAAA")
  assert.deepEqual(generated.sources, ["record.css"])
})

test("Medusa resolves the reviewed PostgreSQL instrumentation already used by the app", () => {
  const native = medusaRequire(
    "@medusajs/deps/opentelemetry/instrumentation-pg"
  )
  assert.equal(
    native.PgInstrumentation,
    backendRequire("@opentelemetry/instrumentation-pg").PgInstrumentation
  )
  const instrumentation = new native.PgInstrumentation({
    enabled: false,
    enhancedDatabaseReporting: false,
  })
  assert.equal(instrumentation.getConfig().enhancedDatabaseReporting, false)
  instrumentation.disable()
})
