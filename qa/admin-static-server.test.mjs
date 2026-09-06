import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setImmediate } from "node:timers/promises"

import {
  ADMIN_ACCEPTANCE_ALLOWED_METHODS,
  rejectAdminAcceptanceMutation,
  startAdminStaticServer,
} from "./admin-static-server.mjs"

test("blocks browser mutations before they can reach any origin", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "CONNECT", "TRACE"]) {
    const aborts = []
    assert.equal(
      rejectAdminAcceptanceMutation(
        {
          abort: async (reason) => {
            aborts.push(reason)
          },
          method: () => method,
        },
        () => assert.fail("A successful abort must not report a failure")
      ),
      true
    )
    assert.deepEqual(aborts, ["blockedbyclient"])
  }

  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(
      rejectAdminAcceptanceMutation(
        {
          abort: async () => {
            assert.fail(`${method} must remain available to read-only fixtures`)
          },
          method: () => method,
        },
        () => assert.fail("Read methods must not report a mutation failure")
      ),
      false
    )
  }
})

for (const failureMode of ["rejected", "thrown"]) {
  test(`records a bounded ${failureMode} abort failure without fallthrough or unhandled rejection`, async () => {
    const issues = []
    const unhandledRejections = []
    const recordUnhandled = () => unhandledRejections.push("unexpected")
    let continued = false
    const request = {
      abort: () => {
        const error = new Error("private-provider-url-and-credential")
        if (failureMode === "thrown") {
          throw error
        }
        return Promise.reject(error)
      },
      continue: () => {
        continued = true
      },
      method: () => "POST",
    }
    process.on("unhandledRejection", recordUnhandled)
    try {
      const blocked = rejectAdminAcceptanceMutation(request, (code) =>
        issues.push(code)
      )
      if (!blocked) {
        request.continue()
      }
      assert.equal(blocked, true)
      await setImmediate()
      assert.equal(continued, false)
      assert.deepEqual(issues, ["request:mutation_block_failed"])
      assert.deepEqual(unhandledRejections, [])
    } finally {
      process.off("unhandledRejection", recordUnhandled)
    }
  })
}

test("wires the browser mutation guard before fixture handling and fallthrough", async () => {
  const source = await readFile(
    new URL("./admin-visual-acceptance.mjs", import.meta.url),
    "utf8"
  )
  assert.match(
    source,
    /page\.on\("request", \(request\) => \{\s+if \(\s*rejectAdminAcceptanceMutation\(request, \(code\) => issues\.push\(code\)\)\s*\) \{\s+return\s+\}\s+const url = new URL\(request\.url\(\)\)/u
  )
})

test("serves local reads and rejects mutations without falling back to HTML", async () => {
  const root = await mkdtemp(join(tmpdir(), "remorseless-admin-methods-"))
  const html = "<!doctype html><title>Read-only Admin fixture</title>"
  await writeFile(join(root, "index.html"), html)
  const server = await startAdminStaticServer({ root })

  try {
    const request = (method, path = "/app/products") =>
      fetch(`${server.baseUrl}${path}`, {
        method,
        signal: AbortSignal.timeout(2_000),
      })

    const get = await request("GET")
    assert.equal(get.status, 200)
    assert.equal(await get.text(), html)
    assert.equal(get.headers.get("cache-control"), "no-store")
    assert.match(get.headers.get("content-type"), /^text\/html/u)

    const head = await request("HEAD")
    assert.equal(head.status, 200)
    assert.equal(await head.text(), "")
    assert.equal(
      head.headers.get("content-type"),
      get.headers.get("content-type")
    )

    const options = await request("OPTIONS")
    assert.equal(options.status, 204)
    assert.equal(options.headers.get("allow"), ADMIN_ACCEPTANCE_ALLOWED_METHODS)
    assert.equal(await options.text(), "")

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await request(method, "/admin/catalog/products")
      assert.equal(response.status, 405)
      assert.equal(
        response.headers.get("allow"),
        ADMIN_ACCEPTANCE_ALLOWED_METHODS
      )
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.equal(await response.text(), "")
    }
  } finally {
    await server.close()
    await rm(root, { force: true, recursive: true })
  }
})
