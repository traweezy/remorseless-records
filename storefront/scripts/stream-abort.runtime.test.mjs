import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { spawn } from "node:child_process"
import { once } from "node:events"
import net from "node:net"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import test from "node:test"

const fixture = fileURLToPath(
  new URL("./fixtures/stream-abort", import.meta.url)
)
const next = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url)
)
const waitFor = async (predicate) => {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Fixture did not reach its expected state")
    await delay(25)
  }
}
test("every installed Next render bundle matches the reviewed backport", async () => {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve("next/package.json"))
  const manifest = JSON.parse(
    await readFile(
      new URL("./fixtures/stream-abort/patch-manifest.json", import.meta.url),
      "utf8"
    )
  )
  assert.equal(manifest.length, 10)
  for (const entry of manifest) {
    const bytes = await readFile(join(root, entry.path))
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.afterSha256,
      entry.path
    )
  }
})

for (const transport of ["rsc", "html"]) {
  test(`production Next preserves render errors and handles cancelled ${transport} streams`, {
    timeout: 30_000,
  }, async (t) => {
    const reservation = net.createServer().listen(0, "127.0.0.1")
    await once(reservation, "listening")
    const { port } = reservation.address()
    await new Promise((resolve) => reservation.close(resolve))
    const child = spawn(
      process.execPath,
      [next, "start", fixture, "-H", "127.0.0.1", "-p", String(port)],
      {
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    let output = ""
    let overflow = false
    let childError = false
    child.on("error", () => {
      childError = true
    })
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        if (output.length + chunk.length > 1_048_576) {
          overflow = true
          return
        }
        output += chunk.toString()
      })
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit")
        child.kill("SIGTERM")
        const force = setTimeout(() => child.kill("SIGKILL"), 5_000)
        try {
          await exited
        } finally {
          clearTimeout(force)
        }
      }
    })
    await waitFor(
      () => output.includes("Ready in") || childError || child.exitCode !== null
    )
    assert.equal(childError, false)
    assert.equal(child.exitCode, null)
    const events = () =>
      output.split("\n").flatMap((line) => {
        try {
          const event = JSON.parse(line)
          return event.event === "fixture.request.error" ? [event] : []
        } catch {
          return []
        }
      })
    const headers = transport === "rsc" ? { RSC: "1" } : {}
    const genuine = await fetch(`http://127.0.0.1:${port}/error`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    })
    await genuine.arrayBuffer()
    await waitFor(() =>
      events().some((event) => event.message === "fixture-render-failure")
    )
    const before = events().length
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/hang`, {
        headers,
        signal: AbortSignal.timeout(5_000),
      })
      assert.equal(response.status, 200)
      const reader = response.body.getReader()
      const first = await reader.read()
      assert.equal(first.done, false)
      assert.ok(first.value.byteLength > 0)
      await reader.cancel()
    }
    await delay(500)
    assert.equal(
      events().length,
      before,
      "Client cancellation must not enter onRequestError"
    )
    assert.equal(overflow, false)
    assert.doesNotMatch(output, /The destination stream closed early/u)
    // The worker remains healthy and genuine render failures are still reported.
    const again = await fetch(`http://127.0.0.1:${port}/error`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    })
    await again.arrayBuffer()
    await waitFor(() => events().length > before)
    assert.ok(
      events().every((event) => event.message === "fixture-render-failure")
    )
  })
}
