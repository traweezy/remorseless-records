import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import test from "node:test"
import {
  CREDENTIAL_SERVICES,
  compareExposedCredentials,
  parseExposedCredentials,
  verifyCredentialServices,
} from "./lib/credential-exposure.mjs"
import { auditStagingCredentials } from "./staging-credential-audit.mjs"

const fixture = () => {
  const values = Array.from({ length: 7 }, () =>
    randomBytes(32).toString("hex")
  )
  const config = {
    projectConfig: {
      databaseUrl: `postgresql://fixture:${values[0]}@localhost/fixture`,
      redisUrl: `redis://default:${values[1]}@localhost:6379`,
      http: { jwtSecret: values[2], cookieSecret: values[3] },
    },
    modules: [
      {
        options: {
          providers: [
            { options: { accessKey: values[6], secretKey: values[4] } },
          ],
        },
      },
      { options: { redisUrl: `redis://default:${values[1]}@localhost:6379` } },
      { options: { providers: [{ options: { api_key: values[5] } }] } },
    ],
  }
  const encode = (data = config) =>
    JSON.stringify([
      { plan: { secrets: ["JWT_SECRET", "COOKIE_SECRET", "DATABASE_URL"] } },
      { message: "ordinary build output" },
      { message: JSON.stringify(data) },
    ])
  const inventories = CREDENTIAL_SERVICES.map((service) => ({
    ...service,
    variables: { FIXTURE: "safe" },
  }))
  return { values, config, encode, inventories }
}

test("parse actual serialized configuration instead of names-only inventory", () => {
  const f = fixture()
  assert.deepEqual(Object.values(parseExposedCredentials(f.encode())), [
    ...f.values.slice(0, 6),
    f.values[6],
  ])
  for (const raw of [
    "{bad",
    "x".repeat(65537),
    "[]",
    "[null]",
    JSON.stringify([{ plan: { secrets: ["JWT_SECRET"] } }]),
  ])
    assert.throws(
      () => parseExposedCredentials(raw),
      /^Error: Credential evidence could not be verified$/u
    )
  const duplicate = JSON.parse(f.encode())
  duplicate.push(duplicate.at(-1))
  assert.throws(() => parseExposedCredentials(JSON.stringify(duplicate)))
})

test("ambiguous, missing and malformed historical credentials fail closed", () => {
  const f = fixture()
  for (const mutate of [
    (c) => {
      c.projectConfig.databaseUrl = "postgresql://localhost/fixture"
    },
    (c) => {
      c.projectConfig.databaseUrl = "https://fixture:password@localhost"
    },
    (c) => {
      c.projectConfig.redisUrl = "redis://default:%XX@localhost"
    },
    (c) => {
      c.projectConfig.http.jwtSecret = ""
    },
    (c) => {
      c.modules[1].options.redisUrl = "redis://default:different@localhost"
    },
    (c) => {
      c.modules.push(c.modules[0])
    },
    (c) => {
      c.modules[2].options.providers = []
    },
  ]) {
    const c = structuredClone(f.config)
    mutate(c)
    assert.throws(
      () => parseExposedCredentials(f.encode(c)),
      /^Error: Credential evidence could not be verified$/u
    )
  }
})

test("detect relocated scalars and URL passwords without exposing values or names", () => {
  const f = fixture()
  const exposed = parseExposedCredentials(f.encode())
  f.inventories[0].variables = {
    PRIVATE_CUSTOM_NAME: exposed.admin_jwt,
    REDIS_URL: `redis://default:${exposed.redis_password}@localhost:6379`,
  }
  f.inventories[1].variables = {
    ROOT_PASSWORD: exposed.media_password,
    ROOT_USER: exposed.media_identifier,
  }
  const report = compareExposedCredentials(exposed, f.inventories)
  assert.equal(report.exposedCredentialsAbsent, false)
  assert.deepEqual(report.services[0].exposedCredentialFamilies, [
    "redis_password",
    "admin_jwt",
  ])
  assert.equal(report.services[1].mediaIdentifierStillPresent, true)
  for (const secret of [...f.values, "PRIVATE_CUSTOM_NAME", "redis://"])
    assert.ok(!JSON.stringify(report).includes(secret))
  for (const entry of f.inventories)
    entry.variables = { KEY: "replacement", USER: exposed.media_identifier }
  const retired = compareExposedCredentials(exposed, f.inventories)
  assert.equal(retired.exposedCredentialsAbsent, true)
  assert.equal(retired.configurationOnly, true)
  assert.equal(retired.credentialRevocationVerified, false)
})

test("encoded URL passwords compare to their decoded historical credential", () => {
  const f = fixture()
  f.config.projectConfig.databaseUrl =
    "postgresql://fixture:a%2Fb%3Ac@localhost/fixture"
  const exposed = parseExposedCredentials(f.encode())
  f.inventories[5].variables = { RENAMED: "a/b:c" }
  assert.deepEqual(
    compareExposedCredentials(exposed, f.inventories).services[5]
      .exposedCredentialFamilies,
    ["postgres_password"]
  )
})

test("missing services, changed identities and unresolved reads never pass", () => {
  const f = fixture()
  verifyCredentialServices(f.inventories)
  for (const entries of [
    f.inventories.slice(1),
    [...f.inventories, f.inventories[0]],
    f.inventories.map((s) => ({ ...s, id: "different" })),
  ])
    assert.throws(() => verifyCredentialServices(entries))
  const exposed = parseExposedCredentials(f.encode())
  for (const variables of [
    {},
    { X: null },
    { X: "${{shared.MISSING}}" },
    { X: "redis://bad:%XX@localhost" },
    { X: "x".repeat(65537) },
  ]) {
    f.inventories[0].variables = variables
    assert.throws(() => compareExposedCredentials(exposed, f.inventories))
  }
})

test("CLI verifies target before secrets, uses exact scoped reads and rechecks services", async () => {
  const f = fixture()
  f.inventories[0].variables.JWT_SECRET = f.values[2]
  const calls = []
  const dependencies = {
    capture: async (cmd, args) => {
      calls.push([cmd, ...args])
      return f.encode()
    },
    railwayReader: async () => {
      calls.push(["identity"])
      return async (args) => {
        calls.push(args)
        if (args[0] === "service") return CREDENTIAL_SERVICES
        const id = args[args.indexOf("--service") + 1]
        assert.ok(args.includes("1f39263a-25e4-4d69-abc2-f0287b331d1e"))
        assert.ok(args.includes("799a2f98-f819-495d-b8b6-12e71af86568"))
        return f.inventories.find((service) => service.id === id).variables
      }
    },
    now: () => new Date("2026-10-03T20:00:00.000Z"),
  }
  const result = await auditStagingCredentials(
    ["--require-retired"],
    dependencies
  )
  assert.equal(result.exitCode, 2)
  assert.deepEqual(calls[0], ["identity"])
  assert.equal(calls[2][0], "git")
  assert.equal(calls.filter((call) => call[0] === "variable").length, 9)
  assert.equal(calls.at(-1)[0], "service")
  const ordinary = await auditStagingCredentials([], dependencies)
  assert.equal(ordinary.exitCode, 0)
  f.inventories[0].variables.JWT_SECRET = "replacement"
  assert.equal(
    (await auditStagingCredentials(["--require-retired"], dependencies))
      .exitCode,
    0
  )
})

test("help and invalid arguments perform no credential or provider reads", async () => {
  const dependencies = {
    railwayReader: async () => {
      throw new Error("must not run")
    },
  }
  assert.match(
    (await auditStagingCredentials(["--help"], dependencies)).help,
    /Read-only/u
  )
  for (const args of [
    ["--other"],
    ["--require-retired", "--require-retired"],
    ["--help", "--require-retired"],
  ])
    await assert.rejects(
      auditStagingCredentials(args, dependencies),
      /Unsupported credential audit arguments/u
    )
  await assert.rejects(
    auditStagingCredentials([], dependencies),
    /must not run/u
  )
})
