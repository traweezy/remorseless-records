import assert from "node:assert/strict"
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { validateRuntimeImageRecord } from "./verify-runtime-image-artifacts.mjs"

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)))
const policy = JSON.parse(
  readFileSync(`${root}/scripts/security/runtime-image-policy.json`, "utf8")
)

const parseArguments = (values) => {
  assert.equal(
    values.length % 2,
    0,
    "Runtime image record arguments must be --key value pairs."
  )
  const entries = []
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    assert.match(key, /^--(?:digest|output|revision|service)$/u)
    assert.ok(value?.length > 0, `${key} requires a value.`)
    entries.push([key.slice(2), value])
  }
  const result = Object.fromEntries(entries)
  assert.equal(Object.keys(result).length, 4, "Arguments must not repeat.")
  return result
}

export const buildRuntimeImageRecord = ({ digest, revision, service }) => {
  assert.ok(Object.hasOwn(policy.services, service), "Unknown runtime service.")
  const servicePolicy = policy.services[service]
  const record = {
    schemaVersion: 1,
    service,
    subject: servicePolicy.image,
    image: `${servicePolicy.image}:${revision}`,
    digest,
    revision,
    baseImage: policy.nodeImage,
    dockerfile: servicePolicy.dockerfile,
    source: policy.repository,
  }
  validateRuntimeImageRecord(record)
  return record
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (executedPath === fileURLToPath(import.meta.url)) {
  const { digest, output, revision, service } = parseArguments(
    process.argv.slice(2)
  )
  const record = buildRuntimeImageRecord({ digest, revision, service })
  writeFileSync(resolve(output), `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  })
}
