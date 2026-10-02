import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { candidateReference } from "./dependency-review-range.mjs"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import {
  assertRevision,
  evaluateReleaseCi,
  evaluateReleaseHealth,
  evaluateStagingDeployments,
  STAGING,
  WORKFLOWS,
} from "./lib/staging-release.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const require = createRequire(import.meta.url)
const usage =
  "Usage: node scripts/staging-release-readiness.mjs --sha <40-hex> [--candidate-base <40-hex>] [--ci-only]"
const ensure = (condition) => {
  if (!condition)
    throw new Error("Release identity or response could not be verified")
}

export const parseArguments = (input) => {
  const args = normalizeScriptArguments(input)
  if (args.length === 1 && args[0] === "--help") return { help: true }
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const key = {
      "--sha": "sha",
      "--candidate-base": "base",
      "--ci-only": "ciOnly",
    }[args[index]]
    ensure(key && !Object.hasOwn(options, key))
    options[key] = key === "ciOnly" ? true : args[++index]
    if (key !== "ciOnly") assertRevision(options[key])
  }
  assertRevision(options.sha)
  if (options.base !== undefined) candidateReference(options.base, options.sha)
  return options
}

export const captureCommand = async (executable, args) => {
  try {
    return (
      await promisify(execFile)(executable, args, {
        cwd: root,
        encoding: "utf8",
        shell: false,
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      })
    ).stdout
  } catch {
    throw new Error("Bounded provider command failed")
  }
}

export const readPublicHealth = async (url, fetcher = fetch) => {
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json" },
  })
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      ensure(size <= 65536)
      chunks.push(value)
    }
    const body = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
    )
    return {
      status: response.status,
      noStore:
        response.headers
          .get("cache-control")
          ?.split(",")
          .some((value) => value.trim().toLowerCase() === "no-store") === true,
      body,
    }
  } finally {
    await reader.cancel()
  }
}

export const DEPLOYMENTS_QUERY = `query StagingRelease($environmentId:String!,$backendId:String!,$storefrontId:String!){
  environment(id:$environmentId){id projectId deploymentTriggers(first:20){edges{node{id projectId environmentId serviceId branch checkSuites provider repository}} pageInfo{hasNextPage}}}
  ${STAGING.services.map((service) => `${service.alias}:serviceInstance(environmentId:$environmentId,serviceId:$${service.alias}Id){serviceId serviceName environmentId healthcheckPath activeDeployments{id status projectId environmentId serviceId meta} latestDeployment{id status meta} domains{serviceDomains{domain environmentId serviceId} customDomains{domain environmentId serviceId}}}`).join("\n")}
}`

export const collectReleaseReadiness = async (
  options,
  { capture = captureCommand, health = readPublicHealth } = {}
) => {
  assertRevision(options.sha)
  if (options.base) candidateReference(options.base, options.sha)
  const { sha, base, ciOnly } = options
  const api = async (path) =>
    JSON.parse(
      await capture("gh", ["api", `repos/${STAGING.repository}/${path}`])
    )
  const [branch, protection, checks, workflowEntries, tag] = await Promise.all([
    api("branches/staging"),
    api("branches/staging/protection"),
    api(`commits/${sha}/check-runs?per_page=100`),
    Promise.all(
      WORKFLOWS.map(async (name) => [
        name,
        await api(
          `actions/workflows/${name}.yml/runs?head_sha=${sha}&event=push&per_page=100`
        ),
      ])
    ),
    base
      ? api(`git/ref/${candidateReference(base, sha).slice(5)}`)
      : Promise.resolve(null),
  ])
  const ci = evaluateReleaseCi({
    sha,
    base,
    branch,
    protection,
    checks,
    workflows: Object.fromEntries(workflowEntries),
    tag,
  })
  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    readOnly: true,
    sha,
    base: base ?? null,
    ci,
    readyForLocalWork: !base && ci.passed,
    readyForAcceptance: false,
    releaseAccepted: false,
  }
  if (ciOnly) {
    const finalBranch = await api("branches/staging")
    ensure(finalBranch.commit.sha === (base ?? sha))
    if (base) {
      const finalTag = await api(
        `git/ref/${candidateReference(base, sha).slice(5)}`
      )
      ensure(
        finalTag.ref === tag.ref &&
          finalTag.object?.type === "commit" &&
          finalTag.object.sha === sha
      )
    }
    return { ...report, passed: ci.passed }
  }
  const binary = join(
    dirname(require.resolve("@railway/cli/package.json")),
    "bin",
    process.platform === "win32" ? "railway.exe" : "railway"
  )
  const railway = async (args) => JSON.parse(await capture(binary, args))
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8")
  )
  ensure(
    (await capture(binary, ["--version"])).trim() ===
      `railway ${manifest.devDependencies["@railway/cli"]}`
  )
  const guard = await readFile(join(root, "scripts/railway-config.mjs"), "utf8")
  ensure(
    [STAGING.projectId, STAGING.environmentId].every((id) =>
      guard.includes(`id: "${id}"`)
    )
  )
  const [status, environments] = await Promise.all([
    railway(["status", "--json"]),
    railway(["environment", "list", "--json"]),
  ])
  ensure(status.id === STAGING.projectId && status.name === "store")
  const linked = environments.environments.filter(
    (environment) => environment.isLinked
  )
  ensure(
    linked.length === 1 &&
      linked[0].id === STAGING.environmentId &&
      linked[0].name === "staging"
  )
  const deploymentSnapshot = async () => {
    const response = await railway([
      "api",
      DEPLOYMENTS_QUERY,
      "--variables",
      JSON.stringify({
        environmentId: STAGING.environmentId,
        backendId: STAGING.services[0].id,
        storefrontId: STAGING.services[1].id,
      }),
      "--compact",
    ])
    ensure(!response.errors)
    return evaluateStagingDeployments(response.data ?? response, base ?? sha)
  }
  const deployments = await deploymentSnapshot()
  const probes = await Promise.all(
    STAGING.services.flatMap((service) =>
      ["/live", "/ready"].map(async (path) => {
        try {
          return evaluateReleaseHealth(
            service,
            path,
            base ?? sha,
            await health(new URL(path, `https://${service.domain}`))
          )
        } catch {
          return { service: service.name, path, passed: false }
        }
      })
    )
  )
  const [after, finalBranch] = await Promise.all([
    deploymentSnapshot(),
    api("branches/staging"),
  ])
  ensure(
    finalBranch.commit.sha === (base ?? sha) &&
      JSON.stringify(after) === JSON.stringify(deployments)
  )
  if (base) {
    const finalTag = await api(
      `git/ref/${candidateReference(base, sha).slice(5)}`
    )
    ensure(
      finalTag.ref === tag.ref &&
        finalTag.object?.type === "commit" &&
        finalTag.object.sha === sha
    )
  }
  const passed =
    ci.passed &&
    deployments.every((service) => service.passed) &&
    probes.every((probe) => probe.passed)
  return {
    ...report,
    deployments,
    health: probes,
    readyForAcceptance: !base && passed,
    candidateChecksPassed: Boolean(base) && passed,
    passed,
    remainingAcceptance: [
      "authenticated_catalog_and_operations",
      "ordinary_exact_revision_scheduler_heartbeat",
      "runtime_package_identity",
      "runtime_and_http_log_correlation",
      "applicable_deployed_browsers",
    ],
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) console.log(usage)
    else {
      const report = await collectReleaseReadiness(options)
      console.log(JSON.stringify(report, null, 2))
      if (!report.passed) process.exitCode = 2
    }
  } catch {
    console.error(
      JSON.stringify({
        readOnly: true,
        passed: false,
        error: "staging_release_readiness_unverified",
      })
    )
    process.exitCode = 1
  }
}
