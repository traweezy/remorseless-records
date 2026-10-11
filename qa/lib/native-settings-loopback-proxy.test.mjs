import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { createServer, request as httpRequest } from "node:http"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { test } from "node:test"
import { setTimeout as navigationDelay } from "node:timers/promises"
import vm from "node:vm"
import {
  assertNativeSettingsControl,
  captureNativeSettingsControl,
  captureNativeSettingsTooltips,
  closeSettingsResources,
  createNativeSettingsNavigationIdle,
  settingsDeniedTarget,
  settingsStoreWriteMismatch,
  settingsWriteShape,
  settleNativeSettingsTooltips,
  startNativeSettingsLoopbackProxy,
  validateSettingsLoopbackOrigin,
  validateSettingsBrowserRoots,
} from "./native-settings-loopback-proxy.mjs"

// These are transport boundary unit fixtures, not initialized native Medusa
// execution or an Admin screenshot/persistence acceptance substitute.
const setup = async (t, handler, options = {}) => {
  const root = await mkdtemp(join(tmpdir(), "rr-settings-proxy-unit-"))
  const index = Buffer.from("<html><body>Transport unit fixture</body></html>")
  await writeFile(join(root, "index.html"), index)
  const calls = []
  const token = randomBytes(24).toString("base64url")
  const native = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    calls.push({
      method: request.method,
      path: request.url,
      bytes: body.length,
    })
    if (handler) return handler(request, response, body)
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify(
        request.url === "/auth/user/emailpass"
          ? { token }
          : { store: { id: "store_owned", name: "Owned" } }
      )
    )
  })
  await new Promise((done) => native.listen(0, "127.0.0.1", done))
  const actors = [
    {
      id: "user_owned",
      email: "unit@example.invalid",
      password: randomBytes(24).toString("base64url"),
    },
  ]
  const proxy = await startNativeSettingsLoopbackProxy({
    upstreamOrigin: `http://127.0.0.1:${native.address().port}`,
    staticRoot: root,
    staticHashes: {
      "index.html": createHash("sha256").update(index).digest("hex"),
    },
    ownedIds: ["store_owned", "user_owned", "role_owned", "policy_owned"],
    actors,
    timeoutMs: 200,
    ...options,
  })
  t.after(async () => {
    try {
      await proxy.close()
    } finally {
      native.closeAllConnections()
      await new Promise((done, reject) =>
        native.close((error) => (error ? reject(error) : done()))
      )
      await rm(root, { recursive: true, force: true })
    }
  })
  const send = (path, method = "GET", body, headers = {}) =>
    fetch(`${proxy.origin}${path}`, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  return { proxy, calls, send, root, actors, token }
}

test("requires a literal loopback HTTP origin without alternate target material", () => {
  assert.equal(
    validateSettingsLoopbackOrigin("http://127.0.0.1:12345").port,
    "12345"
  )
  for (const value of [
    "https://127.0.0.1:12345",
    "http://localhost:12345",
    "http://127.0.0.2:12345",
    "http://127.0.0.1:80",
    "http://127.0.0.1:12345/",
    "http://127.0.0.1:12345?x=1",
    "http://user:pass@127.0.0.1:12345",
    "https://example.invalid",
  ]) {
    assert.throws(() => validateSettingsLoopbackOrigin(value))
  }
})

test("forwards exact native GET bytes without fabricating API data", async (t) => {
  const bytes = Buffer.from(
    '{"store":{"id":"store_owned","name":"Native bytes æ"}}'
  )
  const { send, proxy } = await setup(t, (_request, response) => {
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    })
    response.end(bytes)
  })
  const response = await send("/admin/stores/store_owned")
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  assert.equal(
    proxy.receipts[0].responseBodySha256,
    createHash("sha256").update(bytes).digest("hex")
  )
})
test("denies unknown Settings routes, foreign IDs and query IDs before upstream", async (t) => {
  const { send, calls } = await setup(t)
  for (const path of [
    "/admin/stores/store_foreign",
    "/admin/users/user_foreign/roles",
    "/admin/orders",
    "/admin/catalog/products/store_owned/media",
    "/admin/regions?id=reg_foreign",
    "/admin/users?user_id=user_foreign",
    "/admin/stores/%2Fstore_owned",
    "/admin/payment-providers",
    "/admin/payments",
    "/admin/payments/payment-providers/provider_foreign",
  ]) {
    assert.equal((await send(path)).status, 403)
  }
  assert.equal(calls.length, 0)
})

test("journals rejected native collection targets and query names without forwarding or values", async (t) => {
  const { send, calls, proxy, actors, token } = await setup(t)
  const secret = actors[0].password
  const params = new URLSearchParams({
    q: secret,
    fields: token,
    offset: "20",
    "created_at[$gte]": secret,
  })
  assert.equal(
    (
      await send(`/admin/orders?${params}`, "GET", undefined, {
        authorization: `Bearer ${token}`,
      })
    ).status,
    403
  )
  assert.equal(calls.length, 0)
  assert.deepEqual(proxy.receipts[0], {
    kind: "denied",
    status: 403,
    code: "settings_read_scope_denied",
    method: "GET",
    pathname: "/admin/orders",
    queryKeys: ["created_at[$gte]", "fields", "offset", "q"],
    queryKeysOverflow: false,
  })
  assert(!JSON.stringify(proxy.receipts).includes(secret))
  assert(!JSON.stringify(proxy.receipts).includes(token))
  assert.equal(proxy.receipts[0].query, undefined)
})

test("redacts foreign path material and unrecognized query names from denial diagnostics", async (t) => {
  const { send, calls, proxy, actors, token } = await setup(t)
  const path = `/admin/users/${actors[0].password}?${new URLSearchParams({ [token]: "never-log", user_id: actors[0].email })}`
  assert.equal((await send(path, "DELETE")).status, 403)
  assert.equal(calls.length, 0)
  assert.deepEqual(proxy.receipts[0].pathname, "/admin/users/[redacted]")
  assert.deepEqual(proxy.receipts[0].queryKeys, ["[redacted]", "user_id"])
  const log = JSON.stringify(proxy.receipts)
  for (const value of [actors[0].password, actors[0].email, token, "never-log"])
    assert(!log.includes(value))
})

test("bounds malformed, oversized and excessive-key rejected target diagnostics", () => {
  const owned = new Set(["user_owned"]),
    origin = "http://127.0.0.1:1234"
  assert.deepEqual(
    settingsDeniedTarget(
      { method: "secret-method", url: "http://[" },
      origin,
      owned
    ),
    {
      method: "OTHER",
      pathname: "/[redacted]",
      queryKeys: [],
      queryKeysOverflow: false,
    }
  )
  assert.equal(
    settingsDeniedTarget(
      { method: "PATCH", url: `/admin/${"private".repeat(200)}` },
      origin,
      owned
    ).pathname,
    "/[redacted]"
  )
  const query = new URLSearchParams(
    Array.from({ length: 40 }, (_, i) => [`secret_${i}`, "private"])
  )
  const result = settingsDeniedTarget(
    { method: "GET", url: `/admin/users/user_owned?${query}` },
    origin,
    owned
  )
  assert.equal(result.pathname, "/admin/users/user_owned")
  assert.equal(result.queryKeysOverflow, true)
  assert.deepEqual(result.queryKeys, ["[redacted]"])
  assert(!JSON.stringify(result).includes("private"))
})

const tooltipSample = (extra = {}) => ({
  state: "instant-open",
  opacity: 1,
  effectiveOpacity: 1,
  color: "rgb(82, 82, 91)",
  backgroundColor: "rgb(255, 255, 255)",
  transform: "none",
  display: "block",
  visibility: "visible",
  rect: { x: 10, y: 20, width: 40, height: 25 },
  activeAnimations: 0,
  infiniteAnimations: 0,
  ...extra,
})
const visualClock = (sample) => {
  let elapsed = 0,
    evaluations = 0
  return {
    page: {
      evaluate: async () => {
        evaluations++
        return sample(elapsed, evaluations)
      },
    },
    options: {
      timeoutMs: 100,
      quietMs: 30,
      pollMs: 10,
      now: () => elapsed,
      sleep: async (ms) => {
        elapsed += ms
      },
    },
    evaluations: () => evaluations,
  }
}

const controlSample = (extra = {}) => ({
  tag: "BUTTON",
  role: null,
  type: "button",
  classes: [],
  cursor: "pointer",
  disabled: false,
  fullyVisible: true,
  centreHit: true,
  rect: { x: 260, y: 415, width: 48, height: 32 },
  viewport: { width: 390, height: 844 },
  scroll: { x: 0, y: 0 },
  style: {
    pointerEvents: "auto",
    position: "static",
    zIndex: "auto",
    opacity: 1,
    transform: "none",
    display: "inline-flex",
    visibility: "visible",
    cursor: "pointer",
  },
  hit: { tag: "BUTTON", role: null, classes: [] },
  hitAncestors: [],
  controlAncestors: [],
  activeAnimations: 0,
  infiniteAnimations: 0,
  ...extra,
})

test("captures native control rect and actual occluding node without text, identity values or UI mutation", async () => {
  const style = {
      pointerEvents: "auto",
      position: "static",
      zIndex: "auto",
      opacity: "1",
      transform: "none",
      display: "inline-flex",
      visibility: "visible",
      cursor: "pointer",
    },
    element = (tag, attributes = {}) => ({
      tagName: tag,
      isConnected: true,
      parentElement: null,
      classList: { contains: (name) => name === "absolute" },
      getAttribute: (name) => attributes[name] ?? null,
      getAnimations: () => [],
      matches: () => false,
      getBoundingClientRect: () => ({
        x: 260,
        y: 415,
        left: 260,
        top: 415,
        right: 308,
        bottom: 447,
        width: 48,
        height: 32,
      }),
      contains: () => false,
      setAttribute: () => assert.fail("Observation must not change native DOM"),
      click: () => assert.fail("Observation must not activate controls"),
      focus: () => assert.fail("Observation must not change native focus"),
    }),
    node = element("BUTTON", { type: "button", id: "private-id" }),
    blocker = element("DIV", { role: "private-role", id: "private-occluder" })
  const result = await vm.runInNewContext(
    `(${captureNativeSettingsControl.toString()})(node)`,
    {
      node,
      requestAnimationFrame: (done) => done(0),
      innerWidth: 390,
      innerHeight: 844,
      scrollX: 0,
      scrollY: 12,
      getComputedStyle: () => style,
      document: {
        elementFromPoint: (x, y) => {
          assert.equal(x, 284)
          assert.equal(y, 431)
          return blocker
        },
      },
    }
  )
  assert.equal(result.centreHit, false)
  assert.equal(result.fullyVisible, true)
  assert.equal(result.hit.tag, "DIV")
  assert.equal(result.hit.role, null)
  assert.equal(result.hitAncestors[0].style.opacity, 1)
  assert.equal(result.scroll.y, 12)
  const log = JSON.stringify(result)
  for (const value of ["private-id", "private-role", "private-occluder"])
    assert(!log.includes(value))
})

test("waits for native control geometry and finite animation stability without activating it", async () => {
  const clock = visualClock((time) =>
    controlSample(
      time < 30
        ? {
            rect: { x: 260, y: 415 + time, width: 48, height: 32 },
            activeAnimations: 1,
          }
        : {}
    )
  )
  const proof = await assertNativeSettingsControl(clock.page, clock.options)
  assert(proof.stability.elapsedMs >= 50)
  assert.equal(proof.stability.changedNativeUi, false)
  assert(
    proof.stability.samples.some(
      (sample) => sample.control.activeAnimations === 1
    )
  )
  assert.equal(proof.centreHit, true)
})

test("retains strict occlusion, full-bounds, enabled and pointer failures after stable native samples", async () => {
  for (const [extra, message] of [
    [
      {
        centreHit: false,
        hit: { tag: "DIV", role: null, classes: ["absolute"] },
      },
      /occluded/u,
    ],
    [{ fullyVisible: false }, /clipped/u],
    [{ disabled: true }, /must be enabled/u],
    [{ cursor: "default" }, /interactive cursor/u],
  ]) {
    const clock = visualClock(() => controlSample(extra))
    await assert.rejects(
      assertNativeSettingsControl(clock.page, clock.options),
      (error) => {
        assert.match(error.message, message)
        assert(error.nativeControlProof.samples.length >= 3)
        assert.equal(error.nativeControlProof.changedNativeUi, false)
        if (extra.centreHit === false)
          assert.equal(
            error.nativeControlProof.samples.at(-1).control.hit.tag,
            "DIV"
          )
        return true
      }
    )
  }
})

test("rejects unsettled or invalid native geometry and independently bounds stalled sampling", async () => {
  for (const sample of [
    controlSample({ activeAnimations: 1 }),
    controlSample({ infiniteAnimations: 1 }),
    controlSample({ rect: { x: NaN, y: 415, width: 48, height: 32 } }),
  ]) {
    const clock = visualClock(() => sample)
    await assert.rejects(assertNativeSettingsControl(clock.page, clock.options))
    assert(clock.evaluations() <= 10)
  }
  await assert.rejects(
    assertNativeSettingsControl(
      { evaluate: () => new Promise(() => {}) },
      { timeoutMs: 20, quietMs: 0, pollMs: 5 }
    ),
    /sampling timed out/u
  )
})

test("prepares once after late native layout settles and proves fresh final quiet geometry", async () => {
  let prepared = false,
    preparations = 0
  const clock = visualClock((time) =>
    controlSample(
      prepared
        ? {}
        : {
            rect: {
              x: 260,
              y: time < 40 ? 415 + time : 1196,
              width: 48,
              height: 32,
            },
            fullyVisible: false,
            centreHit: false,
            activeAnimations: time < 20 ? 1 : 0,
          }
    )
  )
  const proof = await assertNativeSettingsControl(clock.page, {
    ...clock.options,
    timeoutMs: 200,
    prepare: async () => {
      preparations++
      prepared = true
    },
  })
  assert.equal(preparations, 1)
  assert.equal(proof.stability.preparation.invocations, 1)
  assert(proof.stability.preparation.startedAtMs >= 70)
  assert(
    proof.stability.elapsedMs - proof.stability.preparation.completedAtMs >=
      clock.options.quietMs
  )
  assert(proof.stability.stableFrames >= 2)
  assert.equal(proof.fullyVisible, true)
  assert.equal(proof.centreHit, true)
  assert(
    proof.stability.samples.some(
      (sample) => sample.phase === "prepare" && !sample.control.fullyVisible
    )
  )
  assert(
    proof.stability.samples.some(
      (sample) => sample.phase === "final" && sample.control.fullyVisible
    )
  )
})

test("never prepares an unsettled control or retries preparation after a final layout shift", async () => {
  let preparations = 0
  const moving = visualClock((time) =>
    controlSample({ rect: { x: 260, y: 415 + time, width: 48, height: 32 } })
  )
  await assert.rejects(
    assertNativeSettingsControl(moving.page, {
      ...moving.options,
      prepare: async () => {
        preparations++
      },
    }),
    /did not stabilize/u
  )
  assert.equal(preparations, 0)
  const shifted = visualClock(() =>
    controlSample(preparations ? { fullyVisible: false, centreHit: false } : {})
  )
  await assert.rejects(
    assertNativeSettingsControl(shifted.page, {
      ...shifted.options,
      prepare: async () => {
        preparations++
      },
    }),
    (error) => {
      assert.match(error.message, /clipped/u)
      assert.equal(error.nativeControlProof.phase, "final")
      assert.equal(error.nativeControlProof.preparation.invocations, 1)
      return true
    }
  )
  assert.equal(preparations, 1)
})

test("retains strict final hit, bounds, enabled and cursor checks after one preparation", async () => {
  for (const [extra, message] of [
    [{ centreHit: false }, /occluded/u],
    [{ fullyVisible: false }, /clipped/u],
    [{ disabled: true }, /must be enabled/u],
    [{ cursor: "default" }, /interactive cursor/u],
  ]) {
    let preparations = 0
    const clock = visualClock(() => controlSample(extra))
    await assert.rejects(
      assertNativeSettingsControl(clock.page, {
        ...clock.options,
        prepare: async () => {
          preparations++
        },
      }),
      (error) => {
        assert.match(error.message, message)
        assert.equal(error.nativeControlProof.phase, "final")
        assert(error.nativeControlProof.samples.length >= 6)
        return true
      }
    )
    assert.equal(preparations, 1)
  }
})

test("shares the original total deadline across preparation and fresh final quiet", async () => {
  let preparations = 0
  const clock = visualClock(() => controlSample())
  await assert.rejects(
    assertNativeSettingsControl(clock.page, {
      ...clock.options,
      timeoutMs: 50,
      prepare: async () => {
        preparations++
      },
    }),
    /did not stabilize/u
  )
  assert.equal(preparations, 1)
  const delayed = visualClock(() => controlSample())
  await assert.rejects(
    assertNativeSettingsControl(delayed.page, {
      ...delayed.options,
      prepare: () => delayed.options.sleep(80),
    }),
    /preparation exceeded overall bound/u
  )
})

test("propagates a preparation error and independently bounds a stalled preparation", async () => {
  const failure = new Error("Owned scroll failed"),
    clock = visualClock(() => controlSample())
  let preparations = 0
  await assert.rejects(
    assertNativeSettingsControl(clock.page, {
      ...clock.options,
      prepare: async () => {
        preparations++
        throw failure
      },
    }),
    (error) => error === failure && error.nativeControlProof.phase === "prepare"
  )
  assert.equal(preparations, 1)
  const stalled = visualClock(() => controlSample())
  await assert.rejects(
    assertNativeSettingsControl(stalled.page, {
      ...stalled.options,
      timeoutMs: 20,
      quietMs: 0,
      pollMs: 5,
      prepare: () => new Promise(() => {}),
    }),
    /preparation timed out/u
  )
})

test("rejects final sampling completed after the shared deadline without accepting late geometry", async () => {
  let preparations = 0
  const clock = visualClock(() => controlSample()),
    evaluate = clock.page.evaluate
  clock.page.evaluate = async () => {
    if (preparations) await clock.options.sleep(100)
    return evaluate()
  }
  await assert.rejects(
    assertNativeSettingsControl(clock.page, {
      ...clock.options,
      prepare: async () => {
        preparations++
      },
    }),
    /sampling exceeded overall bound/u
  )
  assert.equal(preparations, 1)
})

test("shares the 128-sample cap across both phases without a 129th observation", async () => {
  let preparations = 0
  const clock = visualClock((time) =>
    controlSample(
      preparations
        ? { rect: { x: 260, y: 415 + time, width: 48, height: 32 } }
        : {}
    )
  )
  await assert.rejects(
    assertNativeSettingsControl(clock.page, {
      ...clock.options,
      timeoutMs: 2000,
      quietMs: 0,
      pollMs: 1,
      prepare: async () => {
        preparations++
      },
    }),
    (error) => {
      assert.match(error.message, /sample bound exceeded/u)
      assert.equal(error.nativeControlProof.samples.length, 128)
      return true
    }
  )
  assert.equal(clock.evaluations(), 128)
  assert.equal(preparations, 1)
})

test("reads actual tooltip style/ancestor opacity and finite animation state without changing nodes", async () => {
  const parent = { parentElement: null, opacity: "0.5" }
  const node = {
    parentElement: parent,
    opacity: "0.8",
    getAttribute: (name) => (name === "data-state" ? "instant-open" : null),
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 40, height: 25 }),
    getAnimations: () => [
      {
        playState: "running",
        effect: { getComputedTiming: () => ({ iterations: 1 }) },
      },
      {
        playState: "finished",
        effect: { getComputedTiming: () => ({ iterations: Infinity }) },
      },
    ],
  }
  const result = await vm.runInNewContext(
    `(${captureNativeSettingsTooltips.toString()})()`,
    {
      requestAnimationFrame: (done) => done(0),
      document: {
        querySelectorAll: (selector) => {
          assert.equal(selector, ".shadow-elevation-tooltip")
          return [node]
        },
      },
      getComputedStyle: (value) => ({
        opacity: value.opacity,
        color: "rgb(82, 82, 91)",
        backgroundColor: "rgb(255, 255, 255)",
        transform: "none",
        display: "block",
        visibility: "visible",
      }),
    }
  )
  assert.equal(result[0].effectiveOpacity, 0.4)
  assert.equal(result[0].activeAnimations, 1)
  assert.equal(result[0].infiniteAnimations, 0)
  assert.equal(node.opacity, "0.8")
  assert.equal(parent.opacity, "0.5")
})

test("captures an over-bound native frame as an exact scalar count without reading node styles", async () => {
  const node = new Proxy(
    {},
    {
      get: () => {
        assert.fail("An over-bound frame must not inspect tooltip nodes")
      },
    }
  )
  const result = await vm.runInNewContext(
    `(${captureNativeSettingsTooltips.toString()})()`,
    {
      requestAnimationFrame: (done) => done(0),
      document: {
        querySelectorAll: (selector) => {
          assert.equal(selector, ".shadow-elevation-tooltip")
          return Array(21).fill(node)
        },
      },
      getComputedStyle: () => {
        assert.fail("An over-bound frame must not traverse styles")
      },
    }
  )
  assert.equal(result.kind, "native-tooltip-count-over-bound")
  assert.equal(result.count, 21)
  assert.deepEqual(Object.keys(result).sort(), ["count", "kind"])
})

test("waits for transient over-bound counts then fresh finite visual settlement without raising the final cap", async () => {
  const clock = visualClock((time) =>
    time < 20
      ? {
          kind: "native-tooltip-count-over-bound",
          count: time === 0 ? 20 : 21,
        }
      : [tooltipSample(time < 40 ? { activeAnimations: 1 } : {})]
  )
  const result = await settleNativeSettingsTooltips(clock.page, clock.options)
  assert.ok(result.elapsedMs >= 70)
  assert.deepEqual(result.counts, {
    initial: 20,
    maximum: 21,
    final: 1,
    overBoundFrames: 2,
  })
  assert.equal(result.final.length, 1)
  assert.equal(result.final[0].activeAnimations, 0)
  assert.equal(result.changedNativeUi, false)
})

test("a late over-bound native frame resets the continuous quiet interval", async () => {
  const clock = visualClock((time) =>
    time < 20 || time >= 50
      ? []
      : { kind: "native-tooltip-count-over-bound", count: 12 }
  )
  const result = await settleNativeSettingsTooltips(clock.page, clock.options)
  assert.ok(result.elapsedMs >= 80)
  assert.deepEqual(result.counts, {
    initial: 0,
    maximum: 12,
    final: 0,
    overBoundFrames: 3,
  })
  assert.equal(result.final.length, 0)
})

test("all eight final tooltip details remain subject to unchanged finite style and animation checks", async () => {
  const success = visualClock((time) =>
    time === 0
      ? { kind: "native-tooltip-count-over-bound", count: 9 }
      : Array.from({ length: 8 }, () => tooltipSample())
  )
  const result = await settleNativeSettingsTooltips(
    success.page,
    success.options
  )
  assert.equal(result.counts.final, 8)
  assert.equal(result.final.length, 8)
  for (const invalid of [
    { opacity: Number.NaN },
    { infiniteAnimations: 1 },
    { state: "unknown" },
  ]) {
    const failure = visualClock((time) =>
      time === 0
        ? { kind: "native-tooltip-count-over-bound", count: 9 }
        : Array.from({ length: 8 }, (_, index) =>
            tooltipSample(index === 7 ? invalid : {})
          )
    )
    await assert.rejects(
      settleNativeSettingsTooltips(failure.page, failure.options)
    )
    assert.equal(failure.evaluations(), 2)
  }
})

test("permanent over-bound content fails within the unchanged deadline and retains only scalar frames", async () => {
  const clock = visualClock(() => ({
    kind: "native-tooltip-count-over-bound",
    count: 21,
  }))
  await assert.rejects(
    settleNativeSettingsTooltips(clock.page, clock.options),
    (error) => {
      assert.match(error.message, /tooltip count exceeded bound/u)
      assert.equal(error.tooltipSamples.length, 10)
      assert.ok(
        error.tooltipSamples.every(
          (row) => row.tooltips.count === 21 && row.elapsedMs < 100
        )
      )
      return true
    }
  )
  assert.equal(clock.evaluations(), 10)
})

test("malformed count frames cannot bypass native tooltip detail validation", async () => {
  for (const sample of [
    { kind: "native-tooltip-count-over-bound", count: 8 },
    { kind: "native-tooltip-count-over-bound", count: Number.NaN },
    { kind: "native-tooltip-count-over-bound", count: 9.5 },
    { kind: "native-tooltip-count-over-bound", count: 9, ignored: true },
    { kind: "different-frame", count: 9 },
  ]) {
    const clock = visualClock(() => sample)
    await assert.rejects(
      settleNativeSettingsTooltips(clock.page, clock.options)
    )
    assert.equal(clock.evaluations(), 1)
  }
})

test("over-bound observation still uses at most 128 total samples with no 129th query", async () => {
  const clock = visualClock(() => ({
    kind: "native-tooltip-count-over-bound",
    count: 9,
  }))
  await assert.rejects(
    settleNativeSettingsTooltips(clock.page, {
      ...clock.options,
      timeoutMs: 2000,
      quietMs: 0,
      pollMs: 1,
    }),
    (error) => {
      assert.match(error.message, /tooltip sample bound exceeded/u)
      assert.equal(error.tooltipSamples.length, 128)
      return true
    }
  )
  assert.equal(clock.evaluations(), 128)
})

test("a query returning after the overall native deadline cannot become an accepted frame", async () => {
  let elapsed = 0
  await assert.rejects(
    settleNativeSettingsTooltips(
      {
        evaluate: async () => {
          elapsed = 100
          return []
        },
      },
      { timeoutMs: 100, quietMs: 0, now: () => elapsed }
    ),
    (error) => {
      assert.match(error.message, /tooltip sampling timed out/u)
      assert.deepEqual(error.tooltipSamples, [])
      return true
    }
  )
})

test("waits for finite animation completion and successive unchanged native opacity/colors", async () => {
  const clock = visualClock((time) => [
    tooltipSample(
      time < 30
        ? {
            opacity: time / 30,
            effectiveOpacity: time / 30,
            activeAnimations: 1,
          }
        : time < 50
          ? { color: "rgb(90, 90, 95)" }
          : {}
    ),
  ])
  const result = await settleNativeSettingsTooltips(clock.page, clock.options)
  assert(result.elapsedMs >= 70)
  assert(result.stableFrames >= 2)
  assert.equal(result.final[0].opacity, 1)
  assert.equal(result.final[0].color, "rgb(82, 82, 91)")
  assert(result.samples.some((row) => row.tooltips[0].activeAnimations === 1))
  assert.equal(result.changedNativeUi, false)
})

test("quiet interval retains a late native tooltip instead of accepting initial empty frames", async () => {
  const clock = visualClock((time) => (time < 20 ? [] : [tooltipSample()]))
  const result = await settleNativeSettingsTooltips(clock.page, clock.options)
  assert(result.elapsedMs >= 40)
  assert.equal(result.final.length, 1)
  assert(result.samples.some((row) => row.tooltips.length === 0))
  assert(clock.evaluations() >= 5)
})

test("stable native low contrast styles remain available to Axe unchanged", async () => {
  const clock = visualClock(() => [
    tooltipSample({
      color: "rgb(245, 245, 245)",
      backgroundColor: "rgb(250, 250, 250)",
      opacity: 0.8,
      effectiveOpacity: 0.8,
    }),
  ])
  const result = await settleNativeSettingsTooltips(clock.page, clock.options)
  assert.equal(result.final[0].color, "rgb(245, 245, 245)")
  assert.equal(result.final[0].opacity, 0.8)
  assert.equal(result.changedNativeUi, false)
})

test("fails bounded unsettled native tooltip sampling and retains its observed frames", async () => {
  const clock = visualClock(() => [tooltipSample({ activeAnimations: 1 })])
  await assert.rejects(
    settleNativeSettingsTooltips(clock.page, clock.options),
    (error) => {
      assert.match(error.message, /did not stabilize/u)
      assert(error.tooltipSamples.length > 0)
      assert(
        error.tooltipSamples.every(
          (row) => row.tooltips[0].activeAnimations === 1
        )
      )
      return true
    }
  )
  assert(clock.evaluations() <= 10)
})

test("rejects malformed/infinite tooltip states and independently bounds a stalled evaluate", async () => {
  for (const sample of [
    [tooltipSample({ opacity: NaN })],
    [tooltipSample({ infiniteAnimations: 1 })],
    Array(9).fill(tooltipSample()),
  ]) {
    const clock = visualClock(() => sample)
    await assert.rejects(
      settleNativeSettingsTooltips(clock.page, clock.options)
    )
  }
  await assert.rejects(
    settleNativeSettingsTooltips(
      { evaluate: () => new Promise(() => {}) },
      { timeoutMs: 20, quietMs: 0, pollMs: 5 }
    ),
    /sampling timed out/u
  )
})

test("forwards only the exact native Payments provider read path and denies its writes", async (t) => {
  const { send, calls, proxy } = await setup(t)
  assert.equal((await send("/admin/payments/payment-providers")).status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, "/admin/payments/payment-providers")
  assert.throws(() =>
    proxy.arm({
      method: "POST",
      path: "/admin/payments/payment-providers",
      body: {},
    })
  )
  assert.equal(
    (await send("/admin/payments/payment-providers", "POST", {})).status,
    403
  )
  assert.equal(
    (await send("/admin/payments/payment-providers", "DELETE")).status,
    403
  )
  assert.equal(calls.length, 1)
})

test("forwards finite native Settings layout GETs without replacing native denial or authentication", async (t) => {
  const { send, calls, proxy, token } = await setup(t, (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`)
    response.writeHead(403, { "content-type": "application/json" })
    response.end('{"code":"native_not_allowed"}')
  })
  for (const path of [
    "/admin/layouts/sidebar/configuration",
    "/admin/layouts/topbar/configuration",
    "/admin/layouts/settings.sidebar/configuration",
    "/admin/layouts/store.details/configuration",
    "/admin/layouts/user.list/configuration",
    "/admin/layouts/user.details/configuration",
    "/admin/layouts/role.list/configuration",
    "/admin/layouts/role.details/configuration",
    "/admin/layouts/policy.list/configuration",
    "/admin/layouts/policy.details/configuration",
    "/admin/layouts/region.list/configuration",
    "/admin/layouts/region.details/configuration",
    "/admin/layouts/tax.list/configuration",
    "/admin/layouts/tax.details/configuration",
    "/admin/layouts/configurations?limit=1&fields=id",
    "/admin/notifications?fields=created_at&offset=0&limit=1",
  ]) {
    const response = await send(path, "GET", undefined, {
      authorization: `Bearer ${token}`,
    })
    assert.equal(response.status, 403)
    assert.equal(await response.text(), '{"code":"native_not_allowed"}')
    assert.deepEqual(calls.at(-1), { method: "GET", path, bytes: 0 })
  }
  assert.equal(calls.length, 16)
  assert(
    proxy.receipts.every(
      (entry) => entry.kind === "native" && entry.status === 403
    )
  )
  assert(!JSON.stringify(proxy.receipts).includes(token))
})

test("denies alternate shell methods, zones, query values, duplicates and extra keys before upstream", async (t) => {
  const { send, calls } = await setup(t)
  for (const path of [
    "/admin/layouts/footer/configuration",
    "/admin/layouts/sidebar/configuration?limit=1",
    "/admin/layouts/topbar/configuration?q=search",
    "/admin/layouts/configurations",
    "/admin/layouts/configurations?limit=2&fields=id",
    "/admin/layouts/configurations?limit=1&fields=*",
    "/admin/layouts/configurations?limit=1&limit=1&fields=id",
    "/admin/layouts/configurations?limit=1&fields=id&offset=0",
    "/admin/notifications",
    "/admin/notifications?limit=1&offset=1&fields=created_at",
    "/admin/notifications?limit=1&offset=0&fields=*",
    "/admin/notifications?limit=1&offset=0&fields=created_at&q=search",
    "/admin/notifications?limit=1&offset=0&fields=created_at&fields=created_at",
    "/admin/notifications/notification_owned",
  ])
    assert.equal((await send(path)).status, 403)
  for (const path of [
    "/admin/layouts/sidebar/configuration",
    "/admin/layouts/topbar/configuration",
    "/admin/layouts/configurations?limit=1&fields=id",
    "/admin/notifications?limit=1&offset=0&fields=created_at",
  ]) {
    assert.equal((await send(path, "HEAD")).status, 403)
    assert.equal((await send(path, "POST", {})).status, 403)
    assert.equal((await send(path, "DELETE")).status, 403)
  }
  assert.equal(calls.length, 0)
})

test("denies nonliteral Settings layout zones, suffixes, queries and every alternate method before upstream", async (t) => {
  const { send, calls, proxy } = await setup(t)
  for (const zone of [
    "settings.sidebar",
    "store.details",
    "user.list",
    "user.details",
    "role.list",
    "role.details",
    "policy.list",
    "policy.details",
    "region.list",
    "region.details",
    "tax.list",
    "tax.details",
  ]) {
    const path = `/admin/layouts/${zone}/configuration`
    for (const alternate of [
      `${path}/extra`,
      `${path}/`,
      `${path}?fields=id`,
      `${path}?fields=id&fields=id`,
      `${path}?q=owned`,
      `/admin/layouts/${zone}.extra/configuration`,
      `/admin/layouts/${zone.toUpperCase()}/configuration`,
      `/admin/layouts/${zone.replaceAll(".", "%2E")}/configuration`,
    ])
      assert.equal((await send(alternate)).status, 403)
    for (const method of ["HEAD", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"])
      assert.equal(
        (
          await send(
            path,
            method,
            ["POST", "PUT", "PATCH"].includes(method) ? {} : undefined
          )
        ).status,
        403
      )
    assert.throws(() => proxy.arm({ method: "POST", path, body: {} }))
  }
  for (const zone of ["unknown", "product.list", "store", "store.detail"])
    assert.equal(
      (await send(`/admin/layouts/${zone}/configuration`)).status,
      403
    )
  assert.equal(calls.length, 0)
})

test("denies a body on the exact native Settings sidebar GET before upstream", async (t) => {
  const { calls, proxy } = await setup(t)
  const body = Buffer.from("{}")
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(
      `${proxy.origin}/admin/layouts/settings.sidebar/configuration`,
      {
        method: "GET",
        headers: {
          "content-type": "application/json",
          "content-length": body.length,
        },
      },
      (response) => {
        response.on("error", reject)
        response.on("end", () => resolve(response.statusCode))
        response.resume()
      }
    )
    request.on("error", reject)
    request.end(body)
  })
  assert.equal(status, 403)
  assert.equal(calls.length, 0)
  assert.equal(proxy.receipts.length, 1)
  assert.equal(proxy.receipts[0].kind, "denied")
  assert.equal(proxy.receipts[0].code, "settings_read_scope_denied")
})

test("shell scope does not admit global Search collections and journals only fixed shell labels", async (t) => {
  const { send, calls, proxy, token } = await setup(t)
  for (const path of [
    "/admin/orders",
    "/admin/customers",
    "/admin/product-variants",
    "/admin/product-categories",
    "/admin/collections",
    "/admin/inventory-items",
    "/admin/promotions",
    "/admin/campaigns",
    "/admin/price-lists",
    "/admin/customer-groups",
    "/admin/return-reasons",
  ])
    assert.equal((await send(`${path}?q=${token}`)).status, 403)
  assert.equal(
    (await send(`/admin/layouts/sidebar/configuration?private=${token}`))
      .status,
    403
  )
  assert.deepEqual(
    proxy.receipts.at(-1).pathname,
    "/admin/layouts/sidebar/configuration"
  )
  assert.deepEqual(proxy.receipts.at(-1).queryKeys, ["[redacted]"])
  assert.equal(calls.length, 0)
  assert(!JSON.stringify(proxy.receipts).includes(token))
})

test("write mismatch retains immutable intent and bounded type/presence/hash evidence without values", async (t) => {
  const { send, calls, proxy, token, actors } = await setup(t)
  const path = "/admin/stores/store_owned",
    expected = {
      name: actors[0].password,
      supported_currencies: [{ currency_code: "usd", is_default: true }],
    }
  proxy.arm({ method: "POST", path, body: expected })
  const actual = {
    name: token,
    supported_currencies: [{ currency_code: "usd", is_default: "true" }],
    [actors[0].email]: token,
  }
  assert.equal((await send(path, "POST", actual)).status, 403)
  const mismatch = proxy.receipts.at(-1).writeMismatch
  assert.equal(mismatch.intentPending, true)
  assert.equal(mismatch.pathMatched, true)
  assert.equal(mismatch.methodMatched, true)
  assert.equal(mismatch.canonicalBodyMatched, false)
  assert.equal(
    mismatch.actualShape.fields.supported_currencies.items[0].fields.is_default
      .type,
    "string"
  )
  assert.equal(
    mismatch.expectedShape.fields.supported_currencies.items[0].fields
      .is_default.type,
    "boolean"
  )
  assert.equal(mismatch.actualShape.unknownFieldCount, 1)
  for (const key of [
    "requestBodySha256",
    "actualCanonicalBodySha256",
    "expectedCanonicalBodySha256",
  ])
    assert.match(mismatch[key], /^[a-f0-9]{64}$/u)
  const log = JSON.stringify(proxy.receipts)
  for (const value of [
    token,
    actors[0].email,
    actors[0].password,
    '"usd"',
    '"true"',
  ])
    assert(!log.includes(value))
  assert.equal(calls.length, 0)
  assert.equal((await send(path, "POST", expected)).status, 200)
  assert.equal(calls.length, 1)
  assert.equal((await send(path, "POST", expected)).status, 403)
})

test("write shape traversal bounds deep/wide arrays and excludes unknown property names", () => {
  const deep = {
      name: { name: { name: { name: { name: { name: "private" } } } } },
    },
    value = {
      supported_currencies: Array(64).fill(deep),
      "secret-field": "secret-value",
    },
    shape = settingsWriteShape(value),
    log = JSON.stringify(shape)
  assert.equal(shape.fields.supported_currencies.truncated, true)
  assert.equal(shape.unknownFieldCount, 1)
  assert(
    !log.includes("private") &&
      !log.includes("secret-field") &&
      !log.includes("secret-value")
  )
  let nodes = 0
  const count = (node) => {
    nodes++
    for (const field of Object.values(node.fields ?? {})) count(field)
    for (const item of node.items ?? []) count(item)
  }
  count(shape)
  assert(nodes <= 128)
  assert(log.includes('"bounded":true'))
})

test("Store mismatch locates same-type field and ordered currency changes using only fixed hashes and flags", async (t) => {
  const { send, calls, proxy, token, actors } = await setup(t),
    path = "/admin/stores/store_owned",
    expected = {
      name: actors[0].password,
      supported_currencies: [
        { currency_code: "usd", is_default: true },
        { currency_code: "eur", is_default: false },
      ],
      default_region_id: "role_owned",
    },
    actual = {
      name: token,
      supported_currencies: [
        { currency_code: "eur", is_default: true },
        { currency_code: "usd", is_default: false },
      ],
      default_region_id: "user_owned",
      metadata: { [actors[0].email]: token },
    }
  proxy.arm({ method: "POST", path, body: expected })
  assert.equal((await send(path, "POST", actual)).status, 403)
  const proof = proxy.receipts.at(-1).writeMismatch.storeFields
  assert.deepEqual(Object.keys(proof.fields), [
    "name",
    "supported_currencies",
    "default_region_id",
    "default_sales_channel_id",
    "default_location_id",
  ])
  for (const field of ["name", "default_region_id"]) {
    assert.equal(proof.fields[field].expectedType, "string")
    assert.equal(proof.fields[field].actualType, "string")
    assert.equal(proof.fields[field].canonicalMatched, false)
    assert.notEqual(
      proof.fields[field].expectedSha256,
      proof.fields[field].actualSha256
    )
  }
  assert.equal(proof.fields.default_sales_channel_id.expectedPresent, false)
  assert.equal(proof.fields.default_sales_channel_id.actualPresent, false)
  assert.equal(proof.fields.default_sales_channel_id.canonicalMatched, true)
  assert.equal(proof.expectedCurrencies.count, 2)
  assert.equal(proof.actualCurrencies.count, 2)
  assert(
    proof.expectedCurrencies.orderedRowSha256.every((sha) =>
      /^[a-f0-9]{64}$/u.test(sha)
    )
  )
  assert.notDeepEqual(
    proof.expectedCurrencies.orderedRowSha256,
    proof.actualCurrencies.orderedRowSha256
  )
  const log = JSON.stringify(proof)
  for (const value of [
    actors[0].password,
    actors[0].email,
    token,
    "metadata",
    "role_owned",
    "user_owned",
    '"usd"',
    '"eur"',
  ])
    assert(!log.includes(value))
  assert.equal(calls.length, 0)
  assert.equal((await send(path, "POST", expected)).status, 200)
  assert.equal(calls.length, 1)
})

test("Store field proof distinguishes absent/null/types and bounds ordered currency-row hashes", () => {
  const rows = Array.from({ length: 100 }, (_, id) => ({ id })),
    proof = settingsStoreWriteMismatch(
      { supported_currencies: rows },
      {
        supported_currencies: rows.slice().reverse(),
        default_location_id: null,
      }
    )
  assert.equal(proof.fields.default_location_id.expectedPresent, false)
  assert.equal(proof.fields.default_location_id.actualPresent, true)
  assert.equal(proof.fields.default_location_id.actualType, "null")
  assert.equal(proof.fields.default_location_id.canonicalMatched, false)
  assert.equal(proof.expectedCurrencies.count, 100)
  assert.equal(proof.expectedCurrencies.orderedRowSha256.length, 64)
  assert.equal(proof.expectedCurrencies.truncated, true)
  const missing = settingsStoreWriteMismatch(undefined, {
    supported_currencies: "private",
  })
  assert.equal(missing.expectedCurrencies.count, null)
  assert.equal(missing.actualCurrencies.count, null)
  assert.equal(missing.fields.supported_currencies.actualType, "string")
  assert(!JSON.stringify(missing).includes("private"))
})

test("joins real table paging and sorting query evidence without logging authentication material", async (t) => {
  const { send, proxy, actors, token } = await setup(t)
  assert.equal(
    (await send("/admin/users?q=owned-table&limit=20&offset=20&order=-email"))
      .status,
    200
  )
  assert.deepEqual(proxy.receipts[0].query, [
    ["q", "owned-table"],
    ["limit", "20"],
    ["offset", "20"],
    ["order", "-email"],
  ])
  await send("/auth/user/emailpass", "POST", {
    email: actors[0].email,
    password: actors[0].password,
  })
  assert.equal(proxy.receipts[1].query, undefined)
  assert.equal(
    JSON.stringify(proxy.receipts).includes(actors[0].password),
    false
  )
  assert.equal(JSON.stringify(proxy.receipts).includes(token), false)
})

test("denies cross-origin and unsupported-method traffic before upstream", async (t) => {
  const { send, calls } = await setup(t)
  assert.equal(
    (
      await send("/admin/stores", "GET", undefined, {
        origin: "https://example.invalid",
      })
    ).status,
    403
  )
  assert.equal((await send("/admin/stores", "PUT", {})).status, 403)
  assert.equal((await send("/admin/stores", "OPTIONS")).status, 403)
  assert.equal(calls.length, 0)
})

test("requires one exact immutable write intent and preserves it after body mismatch", async (t) => {
  const { proxy, send, calls } = await setup(t)
  const path = "/admin/stores/store_owned"
  const body = { name: "Owned update", metadata: { value: 1 } }
  assert.equal((await send(path, "POST", body)).status, 403)
  proxy.arm({ method: "POST", path, body })
  assert.throws(() => proxy.arm({ method: "POST", path, body }))
  assert.equal(
    (await send(path, "POST", { ...body, name: "Different" })).status,
    403
  )
  assert.equal(
    (await send(path, "POST", { metadata: { value: 1 }, name: body.name }))
      .status,
    200
  )
  assert.equal((await send(path, "POST", body)).status, 403)
  assert.equal(calls.length, 1)
})

test("cannot arm provider, invite, policy, Store-delete or foreign writes", async (t) => {
  const { proxy } = await setup(t)
  for (const [method, path] of [
    ["POST", "/admin/invites"],
    ["POST", "/admin/rbac/policies"],
    ["POST", "/admin/tax-providers/tp_owned"],
    ["POST", "/admin/orders/order_owned"],
    ["POST", "/admin/price-preferences/store_owned"],
    ["POST", "/admin/stock-locations/store_owned"],
    ["POST", "/admin/sales-channels/store_owned"],
    ["DELETE", "/admin/stores/store_owned"],
    ["POST", "/admin/users/user_foreign"],
  ]) {
    assert.throws(() => proxy.arm({ method, path, body: {} }))
  }
})

test("rejects foreign relationship IDs even when the URL itself is owned", async (t) => {
  const { proxy, send, calls } = await setup(t)
  for (const body of [
    { default_region_id: "reg_foreign" },
    { users: ["user_foreign"] },
    { roles: ["role_foreign"] },
    { policies: ["policy_foreign"] },
    { tax_region_id: "txreg_foreign" },
    { provider_id: "tp_foreign" },
    { payment_providers: ["pp_foreign"] },
    { rules: [{ reference: "product", reference_id: "prod_foreign" }] },
  ])
    assert.throws(() =>
      proxy.arm({ method: "POST", path: "/admin/stores/store_owned", body })
    )
  assert.equal((await send("/admin/users?id[0]=user_foreign")).status, 403)
  assert.equal(calls.length, 0)
})

test("binds create acknowledgement entity to its exact native collection", async (t) => {
  const { proxy } = await setup(t)
  assert.throws(() =>
    proxy.arm({
      method: "POST",
      path: "/admin/rbac/roles",
      body: { name: "Owned" },
      responseEntity: "tax_region",
    })
  )
  assert.throws(() =>
    proxy.arm({
      method: "POST",
      path: "/admin/stores/store_owned",
      body: { name: "Owned" },
      responseEntity: "role",
    })
  )
})

test("pins the exact JSON wire body while omitting undefined SDK values", async (t) => {
  const { proxy, send, calls } = await setup(t)
  proxy.arm({
    method: "POST",
    path: "/admin/stores/store_owned",
    body: { name: "Owned", default_region_id: undefined },
  })
  assert.equal(
    (await send("/admin/stores/store_owned", "POST", { name: "Owned" })).status,
    200
  )
  assert.equal(calls.length, 1)
})

test("adds only the validated ID from an armed native create response", async (t) => {
  const { proxy, send } = await setup(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ role: { id: "role_created" } }))
  })
  proxy.arm({
    method: "POST",
    path: "/admin/rbac/roles",
    body: { name: "Created" },
    responseEntity: "role",
  })
  assert.equal(
    (await send("/admin/rbac/roles", "POST", { name: "Created" })).status,
    200
  )
  assert.equal(proxy.owned.has("role_created"), true)
  assert.equal(proxy.receipts[0].createdId, "role_created")
  assert.equal((await send("/admin/rbac/roles/role_created")).status, 200)
})

test("rejects malformed native create IDs without opening broader scope", async (t) => {
  const { proxy, send } = await setup(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ role: { id: "../foreign" } }))
  })
  proxy.arm({
    method: "POST",
    path: "/admin/rbac/roles",
    body: { name: "Created" },
    responseEntity: "role",
  })
  assert.equal(
    (await send("/admin/rbac/roles", "POST", { name: "Created" })).status,
    502
  )
  assert.equal(proxy.owned.has("../foreign"), false)
})

test("keeps native session Cookie and Set-Cookie exclusively in HTTP transport", async (t) => {
  const cookie = `connect.sid=${randomBytes(18).toString("hex")}`
  const { send, proxy } = await setup(t, (request, response) => {
    assert.equal(request.headers.cookie, cookie)
    response.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": `${cookie}; Path=/; HttpOnly`,
    })
    response.end("{}")
  })
  const result = await send("/admin/users/me", "GET", undefined, { cookie })
  assert.equal(result.headers.get("set-cookie"), `${cookie}; Path=/; HttpOnly`)
  assert.ok(!JSON.stringify(proxy.receipts).includes(cookie))
})

test("allows only the seeded actor native login and redacts its payload evidence", async (t) => {
  const { proxy, send, calls, actors } = await setup(t)
  assert.equal(
    (
      await send("/auth/user/emailpass", "POST", {
        email: "foreign@example.invalid",
        password: actors[0].password,
      })
    ).status,
    403
  )
  assert.equal(
    (await send("/auth/user/emailpass", "POST", { ...actors[0], extra: true }))
      .status,
    403
  )
  assert.equal(
    (
      await send("/auth/user/emailpass", "POST", {
        email: actors[0].email,
        password: actors[0].password,
      })
    ).status,
    200
  )
  assert.equal(calls.length, 1)
  assert.ok(!JSON.stringify(proxy.receipts).includes(actors[0].password))
  assert.ok(!Object.hasOwn(proxy.receipts.at(-1), "requestBodySha256"))
})

test("binds session creation to an exact token minted by the owned native login", async (t) => {
  const { proxy, send, calls, actors, token } = await setup(t)
  const authorization = `Bearer ${token}`
  assert.equal(
    (await send("/auth/session", "POST", undefined, { authorization })).status,
    403
  )
  assert.equal(
    (
      await send("/auth/user/emailpass", "POST", {
        email: actors[0].email,
        password: actors[0].password,
      })
    ).status,
    200
  )
  assert.equal(
    (
      await send("/auth/session", "POST", undefined, {
        authorization: `Bearer ${randomBytes(24).toString("base64url")}`,
      })
    ).status,
    403
  )
  assert.equal(
    (await send("/auth/session", "POST", undefined, { authorization })).status,
    200
  )
  assert.equal(calls.length, 2)
  assert.ok(!JSON.stringify(proxy.receipts).includes(token))
})

test("closes in-flight and idle upstream resources before sealing its final journal", async (t) => {
  let started
  const reached = new Promise((done) => {
    started = done
  })
  const { proxy, send } = await setup(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" })
    response.write(" ")
    started()
  })
  const pending = send("/admin/users/me").catch(() => null)
  await reached
  assert.ok(proxy.transportState().upstreamRequests > 0)
  await proxy.close()
  await pending
  const length = proxy.receipts.length
  assert.deepEqual(proxy.transportState(), {
    closed: true,
    activeOperations: 0,
    clientSockets: 0,
    upstreamRequests: 0,
    upstreamSockets: 0,
    agentActiveSockets: 0,
    agentIdleSockets: 0,
    agentQueuedRequests: 0,
  })
  await new Promise((done) => setTimeout(done, 20))
  assert.equal(
    proxy.receipts.length,
    length,
    "Final closed journal must not acquire late entries"
  )
})

test("rejects foreign, Default and symlink roots before compiled inventory", async (t) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "rr-settings-root-unit-"))
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }))
  const artifacts = join(repositoryRoot, "artifacts")
  const adminRoot = join(artifacts, "compiled")
  const artifactRoot = join(artifacts, "evidence", "fresh")
  await mkdir(adminRoot, { recursive: true })
  await validateSettingsBrowserRoots({
    adminRoot,
    artifactRoot,
    repositoryRoot,
  })
  for (const [compiled, output] of [
    [join(repositoryRoot, "Default"), artifactRoot],
    [adminRoot, join(repositoryRoot, "foreign")],
    [join(repositoryRoot, "foreign"), artifactRoot],
  ])
    await assert.rejects(
      validateSettingsBrowserRoots({
        adminRoot: compiled,
        artifactRoot: output,
        repositoryRoot,
      })
    )
  const linked = join(artifacts, "linked")
  await symlink(adminRoot, linked)
  await assert.rejects(
    validateSettingsBrowserRoots({
      adminRoot: linked,
      artifactRoot,
      repositoryRoot,
    })
  )
  await assert.rejects(
    validateSettingsBrowserRoots({
      adminRoot,
      artifactRoot: join(linked, "evidence"),
      repositoryRoot,
    })
  )
})

test("bounds request bytes before any upstream mutation", async (t) => {
  const { proxy, send, calls } = await setup(t)
  assert.throws(() =>
    proxy.arm({
      method: "POST",
      path: "/admin/stores/store_owned",
      body: { name: "x".repeat(32769) },
    })
  )
  assert.equal(
    (
      await send("/admin/stores/store_owned", "POST", {
        name: "x".repeat(32769),
      })
    ).status,
    502
  )
  assert.equal(calls.length, 0)
})

test("binds static bytes to their manifest and refuses changed artifacts", async (t) => {
  const { send, root } = await setup(t)
  assert.equal((await send("/app/settings/store")).status, 200)
  assert.equal((await send("/app/assets/unknown.js")).status, 404)
  assert.equal((await send("/app", "POST", {})).status, 403)
  await writeFile(join(root, "index.html"), "Changed output")
  assert.equal((await send("/app/settings/store")).status, 409)
})

test("rejects a replaced static symlink or directory through the opened descriptor", async (t) => {
  const { send, root } = await setup(t)
  await writeFile(join(root, "owned-target.html"), "Private fixture bytes")
  await rm(join(root, "index.html"))
  await symlink(join(root, "owned-target.html"), join(root, "index.html"))
  assert.equal((await send("/app/settings/store")).status, 403)
  await rm(join(root, "index.html"))
  await mkdir(join(root, "index.html"))
  assert.equal((await send("/app/settings/store")).status, 403)
})

test("delays one actual native permissions response and then restores normal forwarding", async (t) => {
  const { proxy, send, calls } = await setup(t)
  proxy.faultOnce({
    method: "GET",
    path: "/admin/rbac/me/permissions",
    kind: "delay",
    delayMs: 50,
  })
  assert.throws(() =>
    proxy.faultOnce({
      method: "GET",
      path: "/admin/rbac/me/permissions",
      kind: "delay",
    })
  )
  const start = Date.now()
  const pending = send("/admin/rbac/me/permissions")
  const deadline = Date.now() + 1000
  while (
    !proxy.receipts.some((entry) => entry.transportResponseHeld) &&
    Date.now() < deadline
  )
    await new Promise((done) => setTimeout(done, 1))
  const delayed = proxy.receipts.find((entry) => entry.transportResponseHeld)
  assert.ok(
    delayed,
    "The real upstream reply must be held within a bounded deadline"
  )
  assert.equal(delayed.status, 200)
  assert.equal(delayed.transportResponseHeld, true)
  assert.equal((await pending).status, 200)
  assert.equal(delayed.transportResponseHeld, false)
  assert.ok(Date.now() - start >= 45)
  assert.equal((await send("/admin/rbac/me/permissions")).status, 200)
  assert.equal(calls.length, 2)
  assert.equal(proxy.receipts.filter((entry) => entry.transportFault).length, 1)
})

test("drops one successful native write response without replaying its request", async (t) => {
  let committedName = "Original"
  const nativeBody = Buffer.from(
    JSON.stringify({ store: { id: "store_owned", name: "Response lost" } })
  )
  const { proxy, send, calls } = await setup(t, (_request, response, bytes) => {
    committedName = JSON.parse(bytes.toString("utf8")).name
    response.writeHead(200, { "content-type": "application/json" })
    response.end(nativeBody)
  })
  const path = "/admin/stores/store_owned"
  const body = { name: "Response lost" }
  proxy.arm({ method: "POST", path, body })
  proxy.faultOnce({ method: "POST", path, kind: "drop-response" })
  const reply = await send(path, "POST", body)
  assert.equal(reply.status, 200, "The actual committed status must arrive")
  assert.equal(reply.headers.get("content-length"), String(nativeBody.length))
  assert.equal(reply.headers.get("connection"), "close")
  await assert.rejects(
    reply.json(),
    "No usable write acknowledgement may arrive"
  )
  assert.equal(committedName, body.name)
  assert.equal(calls.length, 1)
  assert.equal(proxy.receipts[0].status, 200)
  assert.equal(proxy.receipts[0].transportFault, "drop-response")
  assert.equal(proxy.receipts[0].transportFaultApplied, true)
  assert.equal(
    proxy.receipts[0].transportResponseExpectedBytes,
    nativeBody.length
  )
  assert.equal(proxy.receipts[0].transportResponseSentBytes, 1)
  assert.equal(
    proxy.receipts[0].responseBodySha256,
    createHash("sha256").update(nativeBody).digest("hex")
  )
  assert.equal(
    proxy.receipts.filter((entry) => entry.kind === "denied").length,
    0
  )
  assert.equal((await send(path, "POST", body)).status, 403)
  assert.equal(calls.length, 1, "An unarmed second write must never commit")
  await proxy.close()
  assert.deepEqual(proxy.transportState(), {
    closed: true,
    activeOperations: 0,
    clientSockets: 0,
    upstreamRequests: 0,
    upstreamSockets: 0,
    agentActiveSockets: 0,
    agentIdleSockets: 0,
    agentQueuedRequests: 0,
  })
})

test("times out an upstream response and closes owned transport resources", async (t) => {
  const { proxy, send } = await setup(t, () => {})
  const before = Date.now()
  assert.equal((await send("/admin/users/me")).status, 502)
  assert.ok(Date.now() - before < 1500)
  assert.equal(proxy.receipts.at(-1).code, "settings_transport_failed")
})

test("bounds total response time when upstream keeps sending partial bytes", async (t) => {
  const { send } = await setup(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" })
    const interval = setInterval(() => response.write(" "), 25)
    response.once("close", () => clearInterval(interval))
  })
  const before = Date.now()
  assert.equal((await send("/admin/users/me")).status, 502)
  assert.ok(Date.now() - before < 1500)
})

test("retains a real rejected write response instead of simulating a committed reply loss", async (t) => {
  const { proxy, send, calls } = await setup(t, (_request, response) => {
    response.writeHead(403, { "content-type": "application/json" })
    response.end(JSON.stringify({ message: "Native permission denial" }))
  })
  const path = "/admin/stores/store_owned"
  const body = { name: "Denied update" }
  proxy.arm({ method: "POST", path, body })
  proxy.faultOnce({ method: "POST", path, kind: "drop-response" })
  const reply = await send(path, "POST", body)
  assert.equal(reply.status, 403)
  assert.equal((await reply.json()).message, "Native permission denial")
  assert.equal(calls.length, 1)
  assert.equal(proxy.receipts[0].transportFaultApplied, false)
})

test("preserves the actual supplied native CSP on compiled static bytes and permits both assignable reads", async (t) => {
  const policy = "default-src 'self'; img-src 'self' data: blob:"
  const { send, calls } = await setup(t, undefined, {
    staticResponseHeaders: {
      "content-security-policy": policy,
      "x-content-type-options": "nosniff",
    },
  })
  const staticReply = await send("/app/settings/tax-regions")
  assert.equal(staticReply.headers.get("content-security-policy"), policy)
  assert.equal(staticReply.headers.get("x-content-type-options"), "nosniff")
  assert.equal((await send("/admin/rbac/policies/assignable")).status, 200)
  assert.equal((await send("/admin/rbac/roles/assignable")).status, 200)
  assert.equal((await send("/admin/rbac/policies/foreign")).status, 403)
  assert.equal(calls.length, 2)
})

test("allows the native Tax collection's null-parent read without admitting foreign relationship IDs", async (t) => {
  const { send, calls } = await setup(t)
  assert.equal((await send("/admin/tax-regions?parent_id=null")).status, 200)
  assert.equal(
    (await send("/admin/tax-regions?parent_id=txreg_foreign")).status,
    403
  )
  assert.equal((await send("/admin/users?parent_id=null")).status, 403)
  assert.equal((await send("/admin/tax-regions?parent_id[0]=null")).status, 403)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, "/admin/tax-regions?parent_id=null")
})

test("bounds each stalled cleanup action while still closing the owned proxy and retaining failures", async (t) => {
  const { proxy } = await setup(t)
  const actions = []
  const cleanup = await closeSettingsResources(
    [
      ["stalled-session", () => new Promise(() => {})],
      [
        "rejected-context",
        async () => {
          throw new Error("Owned unit failure")
        },
      ],
      [
        "owned-proxy",
        async () => {
          actions.push("proxy-attempted")
          await proxy.close()
        },
      ],
    ],
    20
  )
  assert.deepEqual(
    cleanup.map(({ name, status }) => ({ name, status })),
    [
      { name: "stalled-session", status: "failed" },
      { name: "rejected-context", status: "failed" },
      { name: "owned-proxy", status: "passed" },
    ]
  )
  assert.match(cleanup[0].error.message, /exceeded 20ms/u)
  assert.deepEqual(actions, ["proxy-attempted"])
  assert.equal(proxy.transportState().closed, true)
  assert.equal(proxy.transportState().activeOperations, 0)
})

// CDP boundary fixtures use the pinned public Puppeteer emitter API. Real
// streamed Chrome bodies, child frames and native Medusa remain required gates.
const { EventEmitter: NativeIdleEmitter } = createRequire(
  new URL("../../package.json", import.meta.url)
)("puppeteer")
class NativeIdleSessionFixture extends NativeIdleEmitter {
  detached = false
  enableFailure = null
  commands = []
  async send(command) {
    assert.equal(command, "Network.enable")
    this.commands.push(command)
    for (const event of idleNetworkEvents)
      assert.equal(this.listenerCount(event), 1)
    if (this.enableFailure) throw this.enableFailure
  }
  async detach() {
    this.detached = true
  }
}
class NativeIdlePageFixture extends NativeIdleEmitter {
  constructor(navigation, timeout = 2000) {
    super()
    this.navigation = navigation
    this.navigationTimeout = timeout
    this.closed = false
    this.session = new NativeIdleSessionFixture()
  }
  async createCDPSession() {
    return this.session
  }
  getDefaultNavigationTimeout() {
    return this.navigationTimeout
  }
  isClosed() {
    return this.closed
  }
  async goto(url, options) {
    assert.equal(options.waitUntil, "load")
    assert.ok(
      Number.isFinite(options.timeout) &&
        options.timeout > 0 &&
        options.timeout <= this.navigationTimeout
    )
    await this.navigation(this, "goto", url)
    return { status: () => 200 }
  }
  async reload(options) {
    assert.equal(options.waitUntil, "load")
    assert.ok(
      Number.isFinite(options.timeout) &&
        options.timeout > 0 &&
        options.timeout <= this.navigationTimeout
    )
    await this.navigation(this, "reload")
    return { status: () => 200 }
  }
}
const idleEvents = ["load", "close"]
const idleNetworkEvents = [
  "Network.requestWillBeSent",
  "Network.loadingFinished",
  "Network.loadingFailed",
]
const networkRequest = (
  requestId,
  frameId = "frame-main",
  type = "Document"
) => ({
  requestId,
  frameId,
  type,
  request: { url: `http://127.0.0.1/owned-${requestId}`, method: "GET" },
})
const idleFixture = async (t, action, timeout) => {
  const page = new NativeIdlePageFixture(action, timeout)
  const idle = await createNativeSettingsNavigationIdle(page)
  t.after(async () => {
    await idle.dispose()
    for (const name of idleEvents) assert.equal(page.listenerCount(name), 0)
    for (const name of idleNetworkEvents)
      assert.equal(page.session.listenerCount(name), 0)
    assert.equal(page.session.detached, true)
  })
  return { page, idle, session: page.session }
}

test("native navigation readiness retains streaming bodies after response headers", async (t) => {
  const { idle, session } = await idleFixture(t, (page) => {
    page.session.emit("Network.requestWillBeSent", networkRequest("document"))
    page.session.emit("Network.requestWillBeSent", networkRequest("body"))
    page.session.emit("Network.loadingFinished", { requestId: "document" })
    page.emit("load")
  })
  let resolved = false
  const navigation = idle.goto("http://127.0.0.1/owned-stream").then(() => {
    resolved = true
  })
  await navigationDelay(25)
  session.emit("Network.responseReceived", { requestId: "body" })
  await navigationDelay(75)
  assert.equal(resolved, false)
  session.emit("Network.loadingFinished", { requestId: "body" })
  await navigation
  const proof = idle.proof()
  assert(proof.quietMs >= 500)
  assert.equal(proof.startedRequests, 2)
  assert.equal(proof.finishedRequests, 2)
  assert.equal(proof.failedRequests, 0)
  assert.equal(proof.responseHeadersAffectCount, false)
  assert.equal(proof.activeRequests, 0)
  assert.equal(proof.lifecycleSource, "owned-CDP-Network")
})

test("native navigation readiness resets continuous500ms idle for late child-frame XHR", async (t) => {
  const { idle, session } = await idleFixture(t, (page) => {
    page.session.emit("Network.requestWillBeSent", networkRequest("document"))
    page.session.emit("Network.loadingFinished", { requestId: "document" })
    page.emit("load")
  })
  let resolved = false
  const navigation = idle.goto("http://127.0.0.1/owned-frame").then(() => {
    resolved = true
  })
  await navigationDelay(200)
  session.emit(
    "Network.requestWillBeSent",
    networkRequest("child-body", "frame-same-origin-child", "XHR")
  )
  session.emit("Network.responseReceived", { requestId: "child-body" })
  await navigationDelay(100)
  assert.equal(resolved, false)
  session.emit("Network.loadingFinished", { requestId: "child-body" })
  await navigation
  assert(idle.proof().quietMs >= 500)
  assert.equal(idle.proof().startedRequests, 2)
  assert.equal(idle.proof().finishedRequests, 2)
  assert(idle.proof().elapsedMs >= 800)
})

test("native navigation readiness counts redirect objects and terminal failed bodies", async (t) => {
  const { idle } = await idleFixture(t, (page, kind) => {
    assert.equal(kind, "reload")
    page.session.emit("Network.requestWillBeSent", networkRequest("redirect"))
    page.session.emit("Network.requestWillBeSent", {
      ...networkRequest("redirect"),
      redirectResponse: { status: 302 },
    })
    page.session.emit("Network.responseReceived", { requestId: "redirect" })
    page.session.emit("Network.loadingFailed", { requestId: "redirect" })
    page.emit("load")
  })
  await idle.reload()
  const proof = idle.proof()
  assert.equal(proof.kind, "reload")
  assert.equal(proof.startedRequests, 2)
  assert.equal(proof.finishedRequests, 1)
  assert.equal(proof.failedRequests, 1)
  assert(proof.quietMs >= 500)
})

test("native navigation readiness fails duplicate and unmatched request lifecycles", async (t) => {
  for (const kind of [
    "duplicate",
    "unmatched-finished",
    "unmatched-failed",
    "unmatched-redirect",
    "malformed-start",
  ]) {
    const { idle } = await idleFixture(t, (page) => {
      if (kind === "duplicate") {
        page.session.emit(
          "Network.requestWillBeSent",
          networkRequest("duplicate")
        )
        page.session.emit(
          "Network.requestWillBeSent",
          networkRequest("duplicate")
        )
      } else if (kind === "unmatched-redirect")
        page.session.emit("Network.requestWillBeSent", {
          ...networkRequest("missing"),
          redirectResponse: { status: 302 },
        })
      else if (kind === "malformed-start")
        page.session.emit("Network.requestWillBeSent", { requestId: "invalid" })
      else
        page.session.emit(
          kind === "unmatched-finished"
            ? "Network.loadingFinished"
            : "Network.loadingFailed",
          { requestId: "missing" }
        )
      page.emit("load")
    })
    await assert.rejects(
      idle.goto("http://127.0.0.1/owned-invalid"),
      /request lifecycle started twice|terminal has no unique active request|redirect has no unique active request|Network request lifecycle is invalid/u
    )
    await assert.rejects(
      idle.dispose(),
      /request lifecycle started twice|terminal has no unique active request|redirect has no unique active request|Network request lifecycle is invalid/u
    )
  }
})

test("native navigation readiness fails page closure while waiting for full bodies", async (t) => {
  const { page, idle } = await idleFixture(t, (page) => {
    page.session.emit("Network.requestWillBeSent", networkRequest("unfinished"))
    page.emit("load")
  })
  const pending = idle.goto("http://127.0.0.1/owned-close")
  const rejected = assert.rejects(
    pending,
    /page closed before body-complete readiness/u
  )
  await navigationDelay(25)
  page.closed = true
  page.emit("close")
  await rejected
  await assert.rejects(
    idle.dispose(),
    /page closed before body-complete readiness/u
  )
})

test("native navigation readiness retains the one original default timeout", async (t) => {
  const { idle } = await idleFixture(
    t,
    async (page) => {
      page.session.emit("Network.requestWillBeSent", networkRequest("document"))
      await navigationDelay(75)
      page.session.emit("Network.loadingFinished", { requestId: "document" })
      page.emit("load")
    },
    100
  )
  const startedAt = performance.now()
  await assert.rejects(
    idle.goto("http://127.0.0.1/owned-timeout"),
    /exceeded 100ms/u
  )
  const elapsed = performance.now() - startedAt
  assert(elapsed >= 100)
  assert(
    elapsed < 400,
    "The500ms quiet period must not extend the original deadline"
  )
})

test("native navigation readiness requires actual load and removes only its own listeners", async (t) => {
  const { page, idle, session } = await idleFixture(t, (page) => {
    page.session.emit("Network.requestWillBeSent", networkRequest("document"))
    page.session.emit("Network.loadingFinished", { requestId: "document" })
  })
  const ownerListener = () => {}
  page.on("request", ownerListener)
  session.on("Network.responseReceived", ownerListener)
  await assert.rejects(
    idle.goto("http://127.0.0.1/owned-no-load"),
    /did not emit its load event/u
  )
  await idle.dispose()
  assert.equal(page.listenerCount("request"), 1)
  assert.equal(session.listenerCount("Network.responseReceived"), 1)
  for (const event of idleEvents) assert.equal(page.listenerCount(event), 0)
  page.off("request", ownerListener)
  session.off("Network.responseReceived", ownerListener)
  await idle.dispose()
})

test("native navigation counts actual font bodies without counting Fetch-only duplicate interceptions", async (t) => {
  const { page, idle, session } = await idleFixture(t, (page) => {
    page.session.emit("Network.requestWillBeSent", networkRequest("document"))
    page.session.emit("Network.loadingFinished", { requestId: "document" })
    page.emit("request", {
      url: () => "http://127.0.0.1/font.woff2",
      resourceType: () => "font",
    })
    page.session.emit("Fetch.requestPaused", {
      requestId: "fetch-only-font",
      request: { url: "http://127.0.0.1/font.woff2" },
    })
    page.session.emit(
      "Network.requestWillBeSent",
      networkRequest("font-body", "frame-main", "Font")
    )
    page.emit("load")
  })
  let resolved = false
  const pending = idle.goto("http://127.0.0.1/owned-font").then(() => {
    resolved = true
  })
  await navigationDelay(75)
  session.emit("Network.responseReceived", { requestId: "font-body" })
  await navigationDelay(25)
  assert.equal(resolved, false)
  session.emit("Network.loadingFinished", { requestId: "font-body" })
  await pending
  assert.equal(idle.proof().startedRequests, 2)
  assert.equal(idle.proof().finishedRequests, 2)
  assert(idle.proof().quietMs >= 500)
})

test("native navigation initialization failure removes listeners and detaches only the owned session", async () => {
  const page = new NativeIdlePageFixture(() => {})
  const original = new Error("Owned Network.enable failed")
  page.session.enableFailure = original
  await assert.rejects(
    createNativeSettingsNavigationIdle(page),
    (problem) => problem === original
  )
  assert.equal(page.session.detached, true)
  for (const event of idleEvents) assert.equal(page.listenerCount(event), 0)
  for (const event of idleNetworkEvents)
    assert.equal(page.session.listenerCount(event), 0)
})

test("native navigation fails a detached owned Network session before quiet success", async (t) => {
  const { idle, session } = await idleFixture(t, (page) => {
    page.session.emit("Network.requestWillBeSent", networkRequest("document"))
    page.session.emit("Network.loadingFinished", { requestId: "document" })
    page.emit("load")
  })
  const pending = idle.goto("http://127.0.0.1/owned-detached")
  const rejected = assert.rejects(
    pending,
    /Network session detached before body-complete readiness/u
  )
  await navigationDelay(25)
  session.detached = true
  await rejected
  await assert.rejects(
    idle.dispose(),
    /Network session detached before body-complete readiness/u
  )
})

test("native prior-body drain retains headers and late auth callback bodies before navigation", async (t) => {
  const calls = []
  const { idle, session } = await idleFixture(t, (page) => {
    calls.push(performance.now())
    page.session.emit(
      "Network.requestWillBeSent",
      networkRequest("new-document")
    )
    page.session.emit("Network.loadingFinished", { requestId: "new-document" })
    page.emit("load")
  })
  session.emit(
    "Network.requestWillBeSent",
    networkRequest("prior-auth-read", "prior-frame", "Fetch")
  )
  const pending = idle.goto("http://127.0.0.1/next-owned-store")
  await navigationDelay(25)
  session.emit("Network.responseReceived", { requestId: "prior-auth-read" })
  await navigationDelay(25)
  const callsAfterHeaders = calls.length
  session.emit("Network.loadingFinished", { requestId: "prior-auth-read" })
  await navigationDelay(250)
  session.emit(
    "Network.requestWillBeSent",
    networkRequest("late-auth-cascade", "prior-frame", "XHR")
  )
  session.emit("Network.responseReceived", { requestId: "late-auth-cascade" })
  await navigationDelay(25)
  const callsBeforeLateBodyFinished = calls.length
  const lastBodyFinishedAt = performance.now()
  session.emit("Network.loadingFinished", { requestId: "late-auth-cascade" })
  await pending
  assert.equal(
    callsAfterHeaders,
    0,
    "Response headers must not permit navigation"
  )
  assert.equal(
    callsBeforeLateBodyFinished,
    0,
    "Late auth callback body must finish before navigation"
  )
  assert.equal(calls.length, 1)
  assert(
    calls[0] - lastBodyFinishedAt >= 500,
    "Late callback resets the whole pre-navigation quiet interval"
  )
  assert.equal(idle.proof().activeRequests, 0)
  assert(idle.proof().quietMs >= 500)
})

test("native prior-body timeout prevents any navigation within the original deadline", async (t) => {
  let calls = 0
  const { idle, session } = await idleFixture(
    t,
    (page) => {
      calls += 1
      page.session.emit(
        "Network.requestWillBeSent",
        networkRequest("unexpected-new-document")
      )
      page.session.emit("Network.loadingFinished", {
        requestId: "unexpected-new-document",
      })
      page.emit("load")
    },
    80
  )
  session.emit(
    "Network.requestWillBeSent",
    networkRequest("never-finished-prior-body", "prior-frame", "Fetch")
  )
  session.emit("Network.responseReceived", {
    requestId: "never-finished-prior-body",
  })
  const startedAt = performance.now()
  await assert.rejects(
    idle.goto("http://127.0.0.1/owned-must-not-navigate"),
    /exceeded 80ms/u
  )
  const elapsed = performance.now() - startedAt
  assert.equal(calls, 0, "A timed-out prior body must prevent the actual goto")
  assert(elapsed >= 80 && elapsed < 400)
})

test("native prior-body drain shares the remaining navigation and post-load deadline", async (t) => {
  let actualNativeTimeout = null
  let calls = 0
  const { page, idle, session } = await idleFixture(
    t,
    (page) => {
      calls += 1
      page.session.emit(
        "Network.requestWillBeSent",
        networkRequest("budget-new-document")
      )
      page.session.emit("Network.loadingFinished", {
        requestId: "budget-new-document",
      })
      page.emit("load")
    },
    900
  )
  const originalGoto = page.goto.bind(page)
  page.goto = (url, options) => {
    actualNativeTimeout = options.timeout
    return originalGoto(url, options)
  }
  session.emit(
    "Network.requestWillBeSent",
    networkRequest("budget-prior-body", "prior-frame", "Fetch")
  )
  const startedAt = performance.now()
  const pending = idle.goto("http://127.0.0.1/owned-one-budget")
  const rejected = assert.rejects(pending, /exceeded 900ms/u)
  await navigationDelay(20)
  session.emit("Network.loadingFinished", { requestId: "budget-prior-body" })
  await rejected
  const elapsed = performance.now() - startedAt
  assert.equal(calls, 1)
  assert(
    actualNativeTimeout > 0 && actualNativeTimeout < 400,
    "Native goto receives only the original remaining budget"
  )
  assert(
    elapsed >= 900 && elapsed < 1300,
    "Pre-drain plus post-load quiet must not reset the original deadline"
  )
})

test("native prior-body drain retains invalid lifecycle and page-close failures before navigation", async (t) => {
  for (const kind of ["unmatched-terminal", "closed-page"]) {
    let calls = 0
    const { page, idle, session } = await idleFixture(t, (page) => {
      calls += 1
      page.session.emit(
        "Network.requestWillBeSent",
        networkRequest("invalid-new-document")
      )
      page.session.emit("Network.loadingFinished", {
        requestId: "invalid-new-document",
      })
      page.emit("load")
    })
    session.emit(
      "Network.requestWillBeSent",
      networkRequest("owned-prior-body", "prior-frame", "Fetch")
    )
    const expected =
      kind === "closed-page"
        ? /page closed before body-complete readiness/u
        : /terminal has no unique active request/u
    const pending = idle.goto("http://127.0.0.1/owned-invalid-drain")
    const rejected = assert.rejects(pending, expected)
    await navigationDelay(15)
    if (kind === "closed-page") {
      page.closed = true
      page.emit("close")
    } else
      session.emit("Network.loadingFinished", {
        requestId: "unknown-prior-body",
      })
    await rejected
    await assert.rejects(idle.dispose(), expected)
    assert.equal(
      calls,
      0,
      "Invalid prior lifecycle must fail before actual navigation"
    )
  }
})
