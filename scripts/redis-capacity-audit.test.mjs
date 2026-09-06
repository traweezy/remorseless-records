import assert from "node:assert/strict"
import test from "node:test"

import {
  REDIS_AUDIT_CONFIG_KEYS,
  REDIS_AUDIT_INFO_SECTIONS,
  evaluateRedisCapacity,
} from "./lib/redis-capacity-audit.mjs"

const serviceLimit = 128 * 1_024 ** 2
const defaults = {
  maxmemory: String(64 * 1_024 ** 2),
  "maxmemory-policy": "noeviction",
  appendonly: "yes",
  appendfsync: "everysec",
  save: "900 1 300 10 60 10000",
  "no-appendfsync-on-rewrite": "no",
}

const fixture = ({
  settings = {},
  sections = {},
  memoryLimitBytes = serviceLimit,
} = {}) => {
  const config = { ...defaults, ...settings }
  const fields = {
    server: { redis_mode: "standalone", uptime_in_seconds: "123" },
    memory: {
      maxmemory: config.maxmemory,
      maxmemory_policy: config["maxmemory-policy"],
      used_memory: "1048576",
      mem_not_counted_for_evict: "0",
      used_memory_rss: "2097152",
      mem_fragmentation_ratio: "2.00",
      total_system_memory: "1099511627776",
    },
    persistence: {
      loading: "0",
      aof_enabled: config.appendonly === "yes" ? "1" : "0",
      rdb_last_bgsave_status: "ok",
      rdb_last_save_time: "123",
      rdb_bgsave_in_progress: "0",
      aof_last_bgrewrite_status: "ok",
      aof_last_write_status: "ok",
      aof_rewrite_in_progress: "0",
      aof_rewrite_scheduled: "0",
      aof_delayed_fsync: "0",
      aof_pending_bio_fsync: "0",
      rdb_last_cow_size: "0",
      aof_last_cow_size: "0",
    },
    stats: {
      evicted_keys: "0",
      rejected_connections: "0",
      latest_fork_usec: "0",
    },
    replication: { role: "master" },
    keyspace: { db0: "keys=3,expires=2,avg_ttl=1000" },
  }
  return {
    config: Object.entries(config).flat(),
    info: Object.fromEntries(
      REDIS_AUDIT_INFO_SECTIONS.map((section) => [
        section,
        [
          `# ${section}`,
          ...Object.entries({ ...fields[section], ...sections[section] })
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}:${value}`),
          "",
        ].join("\r\n"),
      ])
    ),
    memoryLimitBytes,
  }
}

const malformed = (input) =>
  assert.throws(() => evaluateRedisCapacity(input), {
    message: "Redis audit response is malformed",
  })

test("returns immutable credential-free evidence for the bounded standalone policy", () => {
  const input = fixture({
    sections: {
      server: {
        executable: "/private/redis-server",
        config_file: "/private/redis.conf",
      },
      replication: {
        master_host: "private.example",
        masterauth: "private-password",
      },
      keyspace: { db12: "keys=5,expires=1,avg_ttl=0,subexpiry=0" },
    },
  })
  const original = structuredClone(input)
  const result = evaluateRedisCapacity(input)
  assert.equal(result.schemaVersion, 1)
  assert.equal(result.status, "healthy")
  assert.deepEqual(result.reasons, [])
  assert.equal(result.memory.serviceLimitBytes, serviceLimit)
  assert.equal(result.memory.countedBytes, 1048576)
  assert.equal(result.persistence.rdbSaveRuleCount, 3)
  assert.deepEqual(result.stats, {
    evictedKeys: 0,
    rejectedConnections: 0,
    uptimeSeconds: 123,
    latestForkMicroseconds: 0,
    keyCount: 8,
    expiringKeyCount: 3,
    populatedDatabaseCount: 2,
  })
  assert.doesNotMatch(
    JSON.stringify(result),
    /private|db12|db0|total_system_memory/u
  )
  assert.deepEqual(input, original)
  for (const value of [
    result,
    result.reasons,
    result.memory,
    result.persistence,
    result.stats,
  ])
    assert.equal(Object.isFrozen(value), true)
  assert.throws(() => {
    result.memory.usedBytes = 0
  }, TypeError)
  assert.equal(Object.isFrozen(REDIS_AUDIT_CONFIG_KEYS), true)
  assert.equal(Object.isFrozen(REDIS_AUDIT_INFO_SECTIONS), true)
  assert.equal(
    REDIS_AUDIT_CONFIG_KEYS.some((key) => /[?*]/u.test(key)),
    false
  )
})

for (const [name, options, reason] of [
  ["unlimited memory", { settings: { maxmemory: "0" } }, "maxmemory_unbounded"],
  [
    "excess capacity",
    { settings: { maxmemory: String(serviceLimit) } },
    "maxmemory_exceeds_capacity_budget",
  ],
  [
    "unsafe eviction",
    { settings: { "maxmemory-policy": "allkeys-lru" } },
    "eviction_policy_unsafe",
  ],
  ["AOF disabled", { settings: { appendonly: "no" } }, "aof_disabled"],
  [
    "fsync changed",
    { settings: { appendfsync: "always" } },
    "aof_fsync_policy_mismatch",
  ],
  [
    "fsync suppressed",
    { settings: { "no-appendfsync-on-rewrite": "yes" } },
    "aof_fsync_suppressed_during_rewrite",
  ],
  ["RDB disabled", { settings: { save: "" } }, "rdb_schedule_disabled"],
  ["loading", { sections: { persistence: { loading: "1" } } }, "redis_loading"],
  [
    "RDB error",
    { sections: { persistence: { rdb_last_bgsave_status: "err" } } },
    "rdb_last_save_failed",
  ],
  [
    "AOF rewrite error",
    { sections: { persistence: { aof_last_bgrewrite_status: "err" } } },
    "aof_last_rewrite_failed",
  ],
  [
    "AOF write error",
    { sections: { persistence: { aof_last_write_status: "err" } } },
    "aof_last_write_failed",
  ],
  [
    "past eviction",
    { sections: { stats: { evicted_keys: "1" } } },
    "historical_evictions_observed",
  ],
  [
    "past rejection",
    { sections: { stats: { rejected_connections: "1" } } },
    "historical_rejected_connections_observed",
  ],
  [
    "cluster",
    { sections: { server: { redis_mode: "cluster" } } },
    "redis_mode_not_standalone",
  ],
  [
    "replica",
    { sections: { replication: { role: "slave" } } },
    "redis_role_not_primary",
  ],
]) {
  test(`degrades on ${name} with only a fixed reason`, () => {
    const result = evaluateRedisCapacity(fixture(options))
    assert.equal(result.status, "degraded")
    assert.deepEqual(result.reasons, [reason])
  })
}

test("uses an exact inclusive 70 percent maxmemory budget", () => {
  const memoryLimitBytes = 16 * 1_024 ** 2 + 4
  const allowed = Number((BigInt(memoryLimitBytes) * 7n) / 10n)
  const healthy = evaluateRedisCapacity(
    fixture({ settings: { maxmemory: String(allowed) }, memoryLimitBytes })
  )
  assert.equal(healthy.status, "healthy")
  assert.equal(
    evaluateRedisCapacity(
      fixture({
        settings: { maxmemory: String(allowed + 1) },
        memoryLimitBytes,
      })
    ).status,
    "degraded"
  )
  const maximum = 16 * 1_024 ** 4
  assert.equal(
    evaluateRedisCapacity(fixture({ memoryLimitBytes: maximum })).status,
    "healthy"
  )
})

test("separates counted maxmemory use from RSS service headroom", () => {
  const sections = {
    memory: { used_memory: defaults.maxmemory, mem_not_counted_for_evict: "1" },
  }
  assert.equal(evaluateRedisCapacity(fixture({ sections })).status, "healthy")
  sections.memory.mem_not_counted_for_evict = "0"
  assert.deepEqual(evaluateRedisCapacity(fixture({ sections })).reasons, [
    "maxmemory_reached",
  ])
  sections.memory.used_memory = "1048576"
  sections.memory.used_memory_rss = String(Math.ceil(serviceLimit * 0.9))
  assert.deepEqual(evaluateRedisCapacity(fixture({ sections })).reasons, [
    "rss_headroom_low",
  ])
  sections.memory.used_memory_rss = String(serviceLimit + 1)
  assert.equal(
    evaluateRedisCapacity(fixture({ sections })).memory.rssHeadroomBytes,
    0
  )
  sections.memory.mem_not_counted_for_evict = "1048577"
  malformed(fixture({ sections }))
})

test("does not reject healthy background work or claim an RPO from counters", () => {
  const result = evaluateRedisCapacity(
    fixture({
      sections: {
        persistence: {
          rdb_bgsave_in_progress: "1",
          aof_rewrite_in_progress: "1",
          aof_rewrite_scheduled: "1",
          aof_pending_bio_fsync: "1",
          aof_delayed_fsync: "2",
          rdb_last_save_time: "0",
        },
      },
    })
  )
  assert.equal(result.status, "healthy")
  assert.equal(result.persistence.aofDelayedFsync, 2)
  assert.equal(result.persistence.aofRewriteInProgress, true)
  assert.doesNotMatch(
    JSON.stringify(result),
    /rpo|backupVerified|volume|p95|recovered/iu
  )
})

test("permits missing AOF-only fields when AOF is explicitly disabled", () => {
  const result = evaluateRedisCapacity(
    fixture({
      settings: { appendonly: "no" },
      sections: {
        persistence: {
          aof_last_write_status: undefined,
          aof_pending_bio_fsync: undefined,
          aof_delayed_fsync: undefined,
        },
      },
    })
  )
  assert.deepEqual(result.reasons, ["aof_disabled"])
  assert.equal(result.persistence.aofLastWriteStatus, null)
  assert.equal(result.persistence.aofPendingBioFsync, null)
  assert.equal(result.persistence.aofDelayedFsync, null)
})

test("accepts an empty keyspace without inspecting any names or values", () => {
  const input = fixture()
  input.info.keyspace = "# Keyspace\r\n"
  assert.equal(evaluateRedisCapacity(input).stats.keyCount, 0)
  input.info.keyspace = ""
  assert.equal(evaluateRedisCapacity(input).stats.populatedDatabaseCount, 0)
})

test("rejects unknown, missing, duplicate, odd, nested, and unbounded CONFIG replies", () => {
  for (const config of [
    null,
    {},
    [],
    ["maxmemory"],
    Array(10000).fill("0"),
    fixture().config.slice(0, -2),
    [...fixture().config, "requirepass", "private-password"],
  ])
    malformed({ ...fixture(), config })
  for (const [index, value] of [
    [0, "requirepass"],
    [2, "maxmemory"],
    [1, 123],
    [1, ["123"]],
    [1, "x".repeat(513)],
    [1, "123\0"],
  ]) {
    const input = fixture()
    input.config[index] = value
    malformed(input)
  }
})

test("rejects malformed save rules while preserving supported zero-change rules", () => {
  assert.equal(
    evaluateRedisCapacity(fixture({ settings: { save: "900 0" } })).status,
    "healthy"
  )
  for (const save of [
    " ",
    "900",
    "900 1 300",
    "0 1",
    "0900 1",
    "900 -1",
    "900 1.2",
    "900  1",
    "900\t1",
    " 900 1",
    "900 1 ",
    "900 9007199254740992",
    Array(33).fill("900 1").join(" "),
  ])
    malformed(fixture({ settings: { save } }))
})

test("rejects unsafe numeric coercion for all integer and enum boundaries", () => {
  for (const value of [
    "-1",
    "+1",
    "01",
    "1e3",
    "1.0",
    "NaN",
    "Infinity",
    "1junk",
    " 1",
    "1 ",
    "",
    "9007199254740992",
    "12345678901234567",
  ])
    malformed(fixture({ sections: { stats: { evicted_keys: value } } }))
  for (const value of [
    "1e3",
    "-1",
    "NaN",
    "",
    "01.1",
    "1.",
    "1000000",
    "1.1234567",
  ])
    malformed(
      fixture({ sections: { memory: { mem_fragmentation_ratio: value } } })
    )
  for (const settings of [
    { appendonly: "true" },
    { appendfsync: "private-password" },
    { "no-appendfsync-on-rewrite": "true" },
    { "maxmemory-policy": "private-password" },
  ])
    malformed(fixture({ settings }))
  for (const sections of [
    { persistence: { loading: "2" } },
    { persistence: { rdb_last_bgsave_status: "private-password" } },
    { server: { redis_mode: "unknown" } },
    { replication: { role: "unknown" } },
  ])
    malformed(fixture({ sections }))
})

test("requires an explicit bounded service memory limit rather than host RAM", () => {
  for (const memoryLimitBytes of [
    undefined,
    null,
    "134217728",
    NaN,
    Infinity,
    0,
    -1,
    1.5,
    16 * 1_024 ** 2 - 1,
    16 * 1_024 ** 4 + 1,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const input = fixture()
    input.memoryLimitBytes = memoryLimitBytes
    assert.throws(() => evaluateRedisCapacity(input), {
      message: "Redis audit memory limit is invalid",
    })
  }
})

test("fails closed on CONFIG and INFO disagreement", () => {
  for (const sections of [
    { memory: { maxmemory: "1" } },
    { memory: { maxmemory_policy: "allkeys-lru" } },
    { persistence: { aof_enabled: "0" } },
  ])
    assert.throws(() => evaluateRedisCapacity(fixture({ sections })), {
      message: "Redis audit observations are inconsistent",
    })
})

test("requires each section exactly once without inherited section data", () => {
  for (const info of [
    null,
    [],
    new Map(),
    "private-password",
    { ...fixture().info, extra: "private-password" },
    Object.create(fixture().info),
  ])
    malformed({ ...fixture(), info })
  for (const section of REDIS_AUDIT_INFO_SECTIONS) {
    const input = fixture()
    delete input.info[section]
    malformed(input)
  }
  const input = fixture()
  input.info = Object.assign(Object.create(null), input.info)
  assert.equal(evaluateRedisCapacity(input).status, "healthy")
})

test("rejects malformed, missing, duplicate, control-bearing, and oversized INFO fields", () => {
  for (const memory of [
    null,
    {},
    "x".repeat(65537),
    "é".repeat(32769),
    "\n".repeat(1024),
    `field:${"a".repeat(4097)}`,
    "malformed",
    ":value",
    "__proto__:value",
    "field:one\nfield:two",
    "field:secret\0",
    "field:one\rfield:two",
  ])
    malformed({ ...fixture(), info: { ...fixture().info, memory } })
  for (const [section, field] of [
    ["server", "uptime_in_seconds"],
    ["memory", "used_memory"],
    ["persistence", "aof_last_write_status"],
    ["persistence", "aof_pending_bio_fsync"],
    ["stats", "evicted_keys"],
    ["replication", "role"],
  ])
    malformed(fixture({ sections: { [section]: { [field]: undefined } } }))
  const input = fixture()
  input.info.stats += "evicted_keys:0\r\n"
  malformed(input)
})

test("rejects malformed keyspace counts and safe-integer sum overflow", () => {
  for (const keyspace of [
    "customer:key-name",
    "db00:keys=0,expires=0,avg_ttl=0",
    "db1000000:keys=0,expires=0,avg_ttl=0",
    "db0:keys=1,expires=2,avg_ttl=0",
    "db0:keys=1,expires=0",
    "db0:keys=1,expires=0,avg_ttl=0,unknown=1",
    "db0:keys=1,expires=0,avg_ttl=0,keys=2",
    "db0:keys=1=2,expires=0,avg_ttl=0",
    "db0:keys=1,expires=0,avg_ttl=0,subexpiry=-1",
    "db0:keys=9007199254740991,expires=0,avg_ttl=0\ndb1:keys=1,expires=0,avg_ttl=0",
  ])
    malformed({ ...fixture(), info: { ...fixture().info, keyspace } })
})
