import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { readBoundedObservationFile } from "./lib/bounded-observation-file.mjs"

const repository = "traweezy/remorseless-records"
const validSha = (value) =>
  typeof value === "string" &&
  value.length === 40 &&
  /^[a-f0-9]{40}$/u.test(value) &&
  value !== "0".repeat(40)
const requireValue = (condition) => {
  if (!condition) throw new Error("Invalid dependency review range")
}

export const dependencyReviewRange = ({
  eventName,
  ref,
  sha,
  event,
  parentSha,
}) => {
  requireValue(validSha(sha) && event?.repository?.full_name === repository)
  if (eventName === "pull_request") {
    const pr = event.pull_request
    requireValue(
      pr?.base?.repo?.full_name === repository &&
        ["staging", "master"].includes(pr.base.ref) &&
        validSha(pr.base.sha) &&
        validSha(pr.head?.sha)
    )
    return { base: pr.base.sha, head: pr.head.sha }
  }
  requireValue(["push", "workflow_dispatch"].includes(eventName))
  requireValue(["refs/heads/staging", "refs/heads/master"].includes(ref))
  const base = eventName === "push" ? event.before : parentSha
  requireValue(validSha(base) && base !== sha && event.deleted !== true)
  return { base, head: sha }
}

export const runDependencyReviewRange = async (
  env = process.env,
  spawn = spawnSync
) => {
  const git = (args, ancestor = false) => {
    const result = spawn("git", args, {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 256 * 1024,
      shell: false,
    })
    if (ancestor) {
      requireValue(!result.error && result.status === 0)
      return ""
    }
    requireValue(!result.error && result.status === 0)
    return result.stdout.trim()
  }
  requireValue(env.GITHUB_REPOSITORY === repository)
  const event = JSON.parse(
    await readBoundedObservationFile(env.GITHUB_EVENT_PATH, 128 * 1024)
  )
  const range = dependencyReviewRange({
    eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    event,
    parentSha:
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF?.startsWith("refs/heads/")
        ? git(["rev-parse", "--verify", "HEAD^"])
        : undefined,
  })
  requireValue(git(["rev-parse", "HEAD"]) === env.GITHUB_SHA)
  if (env.GITHUB_EVENT_NAME !== "pull_request")
    git(["merge-base", "--is-ancestor", range.base, range.head], true)
  requireValue(
    typeof env.GITHUB_OUTPUT === "string" && env.GITHUB_OUTPUT.length > 0
  )
  appendFileSync(env.GITHUB_OUTPUT, `base=${range.base}\nhead=${range.head}\n`)
  return range
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runDependencyReviewRange().then(
    () => console.log("Verified exact dependency review base and head"),
    () => {
      console.error("Dependency review range could not be verified")
      process.exitCode = 1
    }
  )
}
