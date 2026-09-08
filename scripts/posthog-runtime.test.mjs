import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Socket } from "node:net"
import test from "node:test"

const backendRequire = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const medusaRequire = createRequire(backendRequire.resolve("@medusajs/medusa"))
const analyticsRequire = createRequire(
  medusaRequire.resolve("@medusajs/analytics-posthog")
)
const fixtureHost = "https://posthog.invalid"
const fixtureKey = "phc_runtime_fixture_not_a_key"

const bounded = async (promise) => {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("PostHog fixture exceeded its deadline")),
          2_000
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const response = (cancel = async () => {}) => ({
  status: 200,
  body: { cancel },
  json: async () => ({ status: "ok" }),
  text: async () => "ok",
})

const fixture = (context, transport) => {
  const networkAttempts = []
  const rejectNetwork = () => {
    networkAttempts.push("blocked")
    throw new Error("Unexpected network access in PostHog fixture")
  }
  // Install the guards before loading the actual SDK. No app configuration,
  // provider credentials, Medusa telemetry, or external transport is loaded.
  context.mock.method(globalThis, "fetch", rejectNetwork)
  context.mock.method(Socket.prototype, "connect", rejectNetwork)
  const { PostHog } = backendRequire("posthog-node")
  const errors = []
  const requests = []
  let cleanup = false
  let stopped = false
  const client = new PostHog(fixtureKey, {
    host: fixtureHost,
    disableRemoteConfig: true,
    enableExceptionAutocapture: false,
    enableLocalEvaluation: false,
    disableCompression: true,
    flushAt: 20,
    maxQueueSize: 32,
    flushInterval: 0,
    requestTimeout: 100,
    fetchRetryCount: 0,
    fetch: async (url, options) => {
      assert.equal(url, `${fixtureHost}/batch/`)
      assert.equal(options.method, "POST")
      assert.equal(options.headers["Content-Type"], "application/json")
      assert.ok(options.signal instanceof AbortSignal)
      const payload = JSON.parse(options.body)
      assert.equal(payload.api_key, fixtureKey)
      requests.push({ payload, signal: options.signal })
      return cleanup ? response() : transport(options)
    },
  })
  const removeErrorListener = client.on("error", (error) => {
    errors.push({ name: error.name, cause: error.cause?.name })
  })
  const shutdown = async () => {
    await bounded(client.shutdown(1_000))
    stopped = true
  }
  context.after(async () => {
    // A timed-out queued batch remains queued. Drain it only into the owned
    // successful fixture transport, never by re-enabling the real network.
    cleanup = true
    const errorsBeforeCleanup = errors.length
    try {
      if (!stopped) await shutdown()
      const requestsAfterShutdown = requests.length
      await bounded(client.flush())
      assert.equal(requests.length, requestsAfterShutdown)
      assert.equal(errors.length, errorsBeforeCleanup)
    } finally {
      removeErrorListener()
      assert.deepEqual(networkAttempts, [])
    }
  })
  return { client, errors, requests, shutdown }
}

test("PostHog drains Medusa-shaped capture, identify, and group events on awaited shutdown", {
  timeout: 5_000,
}, async (context) => {
  assert.equal(
    analyticsRequire.resolve("posthog-node"),
    backendRequire.resolve("posthog-node")
  )
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  let cancellations = 0
  const success = response(async () => {
    cancellations += 1
  })
  const { client, errors, requests, shutdown } = fixture(context, () => {
    entered.resolve()
    return release.promise
  })
  context.diagnostic(`PostHog Node ${client.getLibraryVersion()}`)
  client.capture({
    event: "fixture_catalog_viewed",
    distinctId: "fixture-actor",
    properties: {
      category: "records",
      metadata: { formats: ["vinyl", "digital"], available: true },
    },
    groups: { label: "fixture-label" },
  })
  client.identify({
    distinctId: "fixture-actor",
    properties: { plan: "fixture" },
  })
  client.groupIdentify({
    groupType: "label",
    groupKey: "fixture-label",
    distinctId: "fixture-actor",
    properties: { region: "fixture" },
  })
  assert.equal(requests.length, 0)
  let finished = false
  const draining = shutdown().then(() => {
    finished = true
  })
  try {
    await bounded(entered.promise)
    assert.equal(finished, false)
    assert.equal(requests.length, 1)
    const batch = requests[0].payload.batch
    assert.equal(batch.length, 3)
    const events = new Map(batch.map((event) => [event.event, event]))
    assert.equal(events.size, 3)
    for (const event of batch) {
      assert.equal(event.distinct_id, "fixture-actor")
      assert.equal(event.properties.$lib, "posthog-node")
      assert.equal(event.properties.$lib_version, client.getLibraryVersion())
      assert.equal(event.properties.$geoip_disable, true)
    }
    assert.equal(
      events.get("fixture_catalog_viewed").properties.category,
      "records"
    )
    assert.deepEqual(events.get("fixture_catalog_viewed").properties.metadata, {
      formats: ["vinyl", "digital"],
      available: true,
    })
    assert.deepEqual(events.get("fixture_catalog_viewed").properties.$groups, {
      label: "fixture-label",
    })
    assert.deepEqual(events.get("$identify").properties.$set, {
      plan: "fixture",
    })
    const group = events.get("$groupidentify").properties
    assert.equal(group.$group_type, "label")
    assert.equal(group.$group_key, "fixture-label")
    assert.deepEqual(group.$group_set, { region: "fixture" })
  } finally {
    release.resolve(success)
    await draining
  }
  assert.equal(finished, true)
  assert.equal(cancellations, 1)
  await bounded(client.flush())
  assert.equal(requests.length, 1)
  assert.deepEqual(errors, [])
})

test("PostHog aborts a timed-out request and does not retry when retries are disabled", {
  timeout: 5_000,
}, async (context) => {
  let aborted = false
  const { client, requests, errors } = fixture(
    context,
    ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true
            reject(signal.reason)
          },
          { once: true }
        )
      })
  )
  client.capture({ event: "fixture_timeout", distinctId: "fixture-actor" })
  await assert.rejects(
    bounded(client.flush()),
    (error) =>
      error.name === "PostHogFetchNetworkError" &&
      error.cause?.name === "AbortError"
  )
  assert.equal(aborted, true)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].signal.aborted, true)
  assert.deepEqual(errors, [
    { name: "PostHogFetchNetworkError", cause: "AbortError" },
  ])
})

test("PostHog cancels a late response body when transport ignores request abort", {
  timeout: 5_000,
}, async (context) => {
  const late = Promise.withResolvers()
  const cancelled = Promise.withResolvers()
  let cancellations = 0
  const { client, requests, errors } = fixture(context, () => late.promise)
  client.capture({
    event: "fixture_late_response",
    distinctId: "fixture-actor",
  })
  try {
    await assert.rejects(
      bounded(client.flush()),
      (error) =>
        error.name === "PostHogFetchNetworkError" &&
        error.cause?.name === "AbortError"
    )
    assert.equal(requests.length, 1)
    assert.equal(requests[0].signal.aborted, true)
  } finally {
    late.resolve(
      response(async () => {
        cancellations += 1
        cancelled.resolve()
      })
    )
  }
  await bounded(cancelled.promise)
  assert.equal(cancellations, 1)
  assert.deepEqual(errors, [
    { name: "PostHogFetchNetworkError", cause: "AbortError" },
  ])
})
