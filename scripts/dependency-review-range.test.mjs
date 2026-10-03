import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  dependencyReviewRange,
  runDependencyReviewRange,
} from "./dependency-review-range.mjs"

const base = "a".repeat(40)
const head = "b".repeat(40)
const repository = { full_name: "traweezy/remorseless-records" }
const push = {
  eventName: "push",
  ref: "refs/heads/staging",
  sha: head,
  event: { repository, before: base, deleted: false },
}

test("dependency review rejects tag cycles and invalid event or revision identities", () => {
  for (const change of [
    { ref: `refs/tags/staging-candidate/${base}/${head}` },
    { ref: `refs/tags/release/${head}` },
    { eventName: "pull_request_target" },
    { eventName: "schedule" },
    { event: { repository: { full_name: "other/repository" } } },
    { event: { repository, before: base, deleted: true } },
  ])
    assert.throws(() => dependencyReviewRange({ ...push, ...change }))
  for (const sha of ["", "0".repeat(40), "a".repeat(39), `${head}\n`, "--help"])
    assert.throws(() => dependencyReviewRange({ ...push, sha }))
})

test("branch pushes compare the previous remote revision, not only the last commit", () => {
  for (const ref of ["refs/heads/staging", "refs/heads/master"]) {
    const input = { ...push, ref, event: { repository, before: base } }
    assert.deepEqual(dependencyReviewRange(input), {
      base,
      head,
    })
    for (const before of [undefined, head, "0".repeat(40), `${base};exit`])
      assert.throws(() =>
        dependencyReviewRange({ ...input, event: { repository, before } })
      )
  }
  assert.throws(() =>
    dependencyReviewRange({ ...push, ref: "refs/heads/main" })
  )
  assert.deepEqual(
    dependencyReviewRange({
      ...push,
      ref: "refs/heads/staging",
      eventName: "workflow_dispatch",
      parentSha: base,
    }),
    { base, head }
  )
})

test("PRs retain the actual base and head, never the synthetic merge SHA", () => {
  const input = {
    ...push,
    eventName: "pull_request",
    sha: "c".repeat(40),
    event: {
      repository,
      pull_request: {
        base: { repo: repository, ref: "staging", sha: base },
        head: { sha: head },
      },
    },
  }
  assert.deepEqual(dependencyReviewRange(input), {
    base,
    head,
  })
  input.event.pull_request.base.repo = { full_name: "other/repository" }
  assert.throws(() => dependencyReviewRange(input))
})

test("CLI validates checkout and ancestry before publishing outputs, without echoing subprocess errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-review-range-"))
  try {
    const eventPath = join(directory, "event.json")
    const outputPath = join(directory, "output")
    await writeFile(eventPath, JSON.stringify(push.event))
    const env = {
      GITHUB_REPOSITORY: repository.full_name,
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: push.ref,
      GITHUB_SHA: head,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outputPath,
    }
    const calls = []
    const spawn = (command, args, options) => {
      calls.push([command, args])
      assert.equal(command, "git")
      assert.equal(options.shell, false)
      assert.equal(options.timeout, 15000)
      return {
        status: 0,
        stdout: head,
      }
    }
    assert.deepEqual(await runDependencyReviewRange(env, spawn), {
      base,
      head,
    })
    assert.equal(
      await readFile(outputPath, "utf8"),
      `base=${base}\nhead=${head}\n`
    )
    assert.deepEqual(calls.at(-1), [
      "git",
      ["merge-base", "--is-ancestor", base, head],
    ])
    for (const failure of [
      { status: 1, stdout: "private response" },
      { status: 0, stdout: "wrong checkout" },
      { status: null, error: new Error("private response") },
    ]) {
      await writeFile(outputPath, "")
      await assert.rejects(
        runDependencyReviewRange(env, () => failure),
        { message: "Invalid dependency review range" }
      )
      assert.equal(await readFile(outputPath, "utf8"), "")
    }
    await assert.rejects(
      runDependencyReviewRange(
        { ...env, GITHUB_REPOSITORY: "other/repository" },
        spawn
      )
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
