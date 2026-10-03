import { EventEmitter } from "node:events"

import {
  observeDatabasePool,
  sanitizeDatabasePoolObservation,
} from "./database-pool-observation"

const fixture = () => {
  const events = new EventEmitter()
  const pool = {
    numFree: () => 2,
    numUsed: () => 3,
    numPendingAcquires: () => 4,
    numPendingCreates: () => 1,
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
  } as unknown as Parameters<typeof observeDatabasePool>[0]
  return { pool, events }
}

const reused = {
  connection_create_ms: null,
  connection_source: "reused",
  free_before: 2,
  pending_acquires_before: 4,
  pending_creates_before: 1,
  used_before: 3,
}

describe("database acquisition observation", () => {
  afterEach(() => jest.restoreAllMocks())

  it("attributes creation to the acquired connection and preserves independent snapshots", () => {
    const { pool, events } = fixture()
    const clock = jest.spyOn(performance, "now").mockReturnValue(0)
    const first = observeDatabasePool(pool)
    clock.mockReturnValue(10)
    events.emit("createRequest", 7)
    const second = observeDatabasePool(pool)
    const resource = { password: "private-connection-canary" }
    clock.mockReturnValue(90)
    events.emit("createSuccess", 7, resource)
    expect(first.finish(resource)).toEqual({
      ...reused,
      connection_create_ms: 80,
      connection_source: "created",
    })
    expect(second.finish({})).toEqual(reused)
    expect(JSON.stringify(first.finish(resource))).not.toContain("private-")
    first.close()
    second.close()
    expect(events.eventNames()).toEqual([])
  })

  it("does not call an overlapping probe's earlier connection a new connection", () => {
    const { pool, events } = fixture()
    const clock = jest.spyOn(performance, "now").mockReturnValue(0)
    const first = observeDatabasePool(pool)
    events.emit("createRequest", 1)
    const resource = {}
    clock.mockReturnValue(10)
    events.emit("createSuccess", 1, resource)
    clock.mockReturnValue(20)
    const later = observeDatabasePool(pool)
    expect(later.finish(resource)).toEqual(reused)
    first.close()
    later.close()
  })

  it("reports unknown timing for creation that started before this acquisition", () => {
    const { pool, events } = fixture()
    const clock = jest.spyOn(performance, "now").mockReturnValue(0)
    const first = observeDatabasePool(pool)
    events.emit("createRequest", 1)
    clock.mockReturnValue(10)
    const later = observeDatabasePool(pool)
    const resource = {}
    clock.mockReturnValue(20)
    events.emit("createSuccess", 1, resource)
    expect(later.finish(resource)).toEqual({
      ...reused,
      connection_source: "created",
    })
    const alreadyCreating = {}
    events.emit("createSuccess", 2, alreadyCreating)
    expect(first.finish(alreadyCreating).connection_create_ms).toBeNull()
    first.close()
    later.close()
  })

  it("shares three listeners across concurrent probes and removes only its own", () => {
    const { pool, events } = fixture()
    const external = jest.fn()
    events.on("createSuccess", external)
    const probes = Array.from({ length: 20 }, () => observeDatabasePool(pool))
    expect(events.listenerCount("createRequest")).toBe(1)
    expect(events.listenerCount("createSuccess")).toBe(2)
    for (const probe of probes) {
      probe.close()
      probe.close()
    }
    expect(events.listenerCount("createRequest")).toBe(0)
    expect(events.listeners("createSuccess")).toEqual([external])
    const again = observeDatabasePool(pool)
    expect(events.listenerCount("createRequest")).toBe(1)
    again.close()
  })

  it("drops failed and excess starts without retaining resources or raw errors", () => {
    const { pool, events } = fixture()
    const probe = observeDatabasePool(pool)
    events.emit("createRequest", 1)
    events.emit("createFail", 1, new Error("private-error"))
    const resource = {}
    events.emit("createSuccess", 1, resource)
    expect(probe.finish(resource).connection_create_ms).toBeNull()
    for (let id = 2; id <= 1_002; id++) events.emit("createRequest", id)
    events.emit("createSuccess", 1_002, resource)
    expect(probe.finish(resource).connection_create_ms).toBeNull()
    events.emit("createSuccess", 2, null)
    expect(probe.finish(null).connection_source).toBe("unknown")
    probe.close()
    expect(events.eventNames()).toEqual([])
  })
})

describe("public pool diagnostics", () => {
  it("retains only allowlisted counts and timing", () => {
    expect(
      sanitizeDatabasePoolObservation({ ...reused, secret: "private" }, 10)
    ).toEqual(reused)
    expect(
      sanitizeDatabasePoolObservation(
        { ...reused, connection_source: "created", connection_create_ms: 9 },
        10
      )?.connection_create_ms
    ).toBe(9)
  })

  it.each([
    null,
    [],
    false,
    {},
    Object.create(reused),
    { ...reused, free_before: -1 },
    { ...reused, used_before: 1.2 },
    { ...reused, pending_acquires_before: 100_001 },
    { ...reused, pending_creates_before: "1" },
    { ...reused, connection_source: "private-error" },
    { ...reused, connection_create_ms: 0 },
    { ...reused, connection_source: "created", connection_create_ms: 11 },
    { ...reused, connection_source: "created", connection_create_ms: -1 },
    { ...reused, connection_source: "created", connection_create_ms: 1.2 },
  ])("rejects malformed or inconsistent observation %#", (value) => {
    expect(sanitizeDatabasePoolObservation(value, 10)).toBeUndefined()
  })
})
