import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import http from "node:http"
import net from "node:net"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { ciStorefrontProviderEnv } from "../playwright.ci-provider.ts"

const storefront = fileURLToPath(new URL("..", import.meta.url))
const traceId = "1234567890abcdef1234567890abcdef"
const waitFor = async (predicate, message, timeout = 5_000) => {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message)
    await delay(25)
  }
}

const verifyConcurrentCompletion = async (t, completionOrder) => {
  const pending = []
  const backend = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/ready") {
      pending.push(response)
      return
    }
    response.writeHead(404).end()
  })
  t.after(async () => {
    backend.closeAllConnections()
    if (backend.listening) {
      await new Promise((resolve) => backend.close(resolve))
    }
  })
  backend.headersTimeout = 5_000
  backend.requestTimeout = 5_000
  backend.listen(0, "127.0.0.1")
  await once(backend, "listening")
  const backendAddress = backend.address()
  assert.ok(backendAddress && typeof backendAddress === "object")
  const providerUrl = `http://127.0.0.1:${backendAddress.port}`
  const reservation = net.createServer()
  t.after(async () => {
    if (reservation.listening) {
      await new Promise((resolve) => reservation.close(resolve))
    }
  })
  reservation.listen(0, "127.0.0.1")
  await once(reservation, "listening")
  const address = reservation.address()
  assert.ok(address && typeof address === "object")
  await new Promise((resolve) => reservation.close(resolve))
  const baseUrl = `http://127.0.0.1:${address.port}`
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(address.port),
    ],
    {
      cwd: storefront,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...ciStorefrontProviderEnv,
        MEDUSA_BACKEND_URL: providerUrl,
        NEXT_PUBLIC_MEDUSA_URL: providerUrl,
        NEXT_PUBLIC_MEDUSA_BACKEND_URL: providerUrl,
        NEXT_PUBLIC_SITE_URL: baseUrl,
        NEXT_PUBLIC_BASE_URL: baseUrl,
        NEXT_PUBLIC_STRIPE_PK: "pk_test_completion_fixture",
        REDIS_URL: "",
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        OTEL_TRACES_EXPORTER: "none",
        OTEL_METRICS_EXPORTER: "none",
        OTEL_LOGS_EXPORTER: "none",
      },
    }
  )
  let cleanup
  const stopChild = () => {
    cleanup ??= (async () => {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit")
        child.kill("SIGTERM")
        const forceStop = setTimeout(() => child.kill("SIGKILL"), 5_000)
        try {
          await exited
        } finally {
          clearTimeout(forceStop)
        }
      }
    })()
    return cleanup
  }
  t.after(stopChild)
  let output = ""
  let overflow = false
  let childError = false
  child.on("error", () => {
    childError = true
  })
  const collect = (chunk) => {
    if (output.length + chunk.length > 1_048_576) {
      overflow = true
      return
    }
    output += chunk.toString("utf8")
  }
  child.stdout.on("data", collect)
  child.stderr.on("data", collect)
  const completionEvents = () =>
    output.split("\n").flatMap((line) => {
      try {
        const event = JSON.parse(line)
        return event?.event === "http.request.completed" ? [event] : []
      } catch {
        return []
      }
    })
  try {
    await waitFor(
      () =>
        output.includes("Ready in") || child.exitCode !== null || childError,
      "Next did not start",
      15_000
    )
    assert.equal(childError, false, "Next child could not start")
    assert.equal(child.exitCode, null, "Next exited before acceptance")
    const requests = Array.from({ length: 4 }, (_, index) => {
      const requestId = `concurrent_completion_${index}`
      return fetch(`${baseUrl}/api/healthcheck`, {
        headers: {
          "x-request-id": requestId,
          traceparent: `00-${traceId}-1111111111111111-01`,
        },
        signal: AbortSignal.timeout(10_000),
      }).then(async (response) => {
        await response.arrayBuffer()
        assert.equal(
          response.status,
          503,
          "The isolated fixture intentionally has no Redis"
        )
        assert.equal(response.headers.get("x-request-id"), requestId)
        return { requestId, traceparent: response.headers.get("traceparent") }
      })
    })
    // Every request must reach its provider before any may complete. This
    // deterministically reproduces the old trace-only registry overwrite.
    const allRequests = Promise.all(requests)
    void allRequests.catch(() => undefined)
    await waitFor(
      () => pending.length === 4,
      "Requests did not overlap at the provider",
      2_500
    )
    assert.ok(
      pending.every(
        (response) => !response.destroyed && !response.writableEnded
      ),
      "All provider responses must still be held"
    )
    assert.equal(
      completionEvents().filter((event) => event.trace_id === traceId).length,
      0,
      "No target request may complete before the provider barrier releases"
    )
    const releases =
      completionOrder === "first-root-first" ? pending : pending.toReversed()
    for (const [index, response] of releases.entries()) {
      response.writeHead(200).end()
      await waitFor(
        () =>
          completionEvents().filter((event) => event.trace_id === traceId)
            .length >=
          index + 1,
        "Released request did not complete"
      )
      assert.equal(
        completionEvents().filter((event) => event.trace_id === traceId).length,
        index + 1,
        "Completing one request must not end held sibling requests"
      )
      assert.ok(
        releases
          .slice(index + 1)
          .every((held) => !held.destroyed && !held.writableEnded)
      )
    }
    const responses = await allRequests
    assert.equal(
      new Set(responses.map((response) => response.traceparent)).size,
      4
    )
    await waitFor(
      () =>
        completionEvents().filter((event) => event.trace_id === traceId)
          .length === 4,
      "Each sibling must produce its own completion event"
    )
    const events = completionEvents().filter(
      (event) => event.trace_id === traceId
    )
    assert.deepEqual(
      events.map((event) => event.request_id).sort(),
      responses.map((response) => response.requestId).sort()
    )
    assert.equal(new Set(events.map((event) => event.span_id)).size, 4)
    for (const event of events) {
      assert.equal(event.status, 503)
      assert.equal(event.method, "GET")
      assert.equal(event.service, "storefront")
      assert.ok(Number.isFinite(event.duration_ms) && event.duration_ms >= 0)
      assert.deepEqual(
        Object.keys(event).sort(),
        [
          "commit_sha",
          "duration_ms",
          "environment",
          "event",
          "message",
          "method",
          "request_id",
          "service",
          "span_id",
          "status",
          "trace_id",
        ].sort()
      )
    }
    const guard = await fetch(`${baseUrl}/api/products?limit=invalid`, {
      signal: AbortSignal.timeout(5_000),
    })
    await guard.arrayBuffer()
    assert.equal(guard.status, 400)
    const generatedRequestId = guard.headers.get("x-request-id")
    assert.ok(generatedRequestId)
    await waitFor(
      () =>
        completionEvents().some(
          (event) => event.request_id === generatedRequestId
        ),
      "Untraced requests must retain completion correlation"
    )
    assert.equal(
      completionEvents().filter(
        (event) => event.request_id === generatedRequestId
      ).length,
      1
    )
    assert.equal(overflow, false, "Runtime output exceeded its bounded capture")
  } finally {
    backend.closeAllConnections()
    await new Promise((resolve) => backend.close(resolve))
    await stopChild()
  }
}

for (const completionOrder of ["first-root-first", "first-root-last"]) {
  test(
    `built Next isolates concurrent request completion (${completionOrder})`,
    {
      timeout: 30_000,
    },
    (t) => verifyConcurrentCompletion(t, completionOrder)
  )
}
