export const REDIS_AUDIT_CONFIG_KEYS = Object.freeze([
  "maxmemory",
  "maxmemory-policy",
  "appendonly",
  "appendfsync",
  "save",
  "no-appendfsync-on-rewrite",
])

export const REDIS_AUDIT_INFO_SECTIONS = Object.freeze([
  "server",
  "memory",
  "persistence",
  "stats",
  "replication",
  "keyspace",
])

const malformed = () => new Error("Redis audit response is malformed")
const memoryLimitError = () => new Error("Redis audit memory limit is invalid")
const policyValues = Object.freeze([
  "noeviction",
  "allkeys-lru",
  "allkeys-lfu",
  "allkeys-lrm",
  "allkeys-random",
  "volatile-lru",
  "volatile-lfu",
  "volatile-lrm",
  "volatile-random",
  "volatile-ttl",
])

const integer = (value) => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,15})$/u.test(value))
    throw malformed()
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw malformed()
  return number
}

const choice = (value, values) => {
  if (!values.includes(value)) throw malformed()
  return value
}

const flag = (value) => choice(value, ["0", "1"]) === "1"
const yesNo = (value) => choice(value, ["yes", "no"]) === "yes"
const status = (value) => choice(value, ["ok", "err"])

const record = (value) => {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw malformed()
  return value
}

const parseConfig = (input) => {
  if (
    !Array.isArray(input) ||
    input.length !== REDIS_AUDIT_CONFIG_KEYS.length * 2
  )
    throw malformed()
  const values = new Map()
  for (let index = 0; index < input.length; index += 2) {
    const key = input[index]
    const value = input[index + 1]
    if (
      !REDIS_AUDIT_CONFIG_KEYS.includes(key) ||
      values.has(key) ||
      typeof value !== "string" ||
      value.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(value)
    )
      throw malformed()
    values.set(key, value)
  }
  return values
}

const parseInfoSection = (input) => {
  if (typeof input !== "string" || Buffer.byteLength(input) > 65_536)
    throw malformed()
  const lines = input.split(/\r?\n/u)
  if (lines.length > 1_024) throw malformed()
  const values = new Map()
  for (const line of lines) {
    if (line.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(line))
      throw malformed()
    if (line === "" || line.startsWith("#")) continue
    const separator = line.indexOf(":")
    if (separator < 1) throw malformed()
    const key = line.slice(0, separator)
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(key) || values.has(key))
      throw malformed()
    values.set(key, line.slice(separator + 1))
  }
  return values
}

const saveRules = (value) => {
  if (value === "") return 0
  if (!/^[0-9]+ [0-9]+(?: [0-9]+ [0-9]+)*$/u.test(value)) throw malformed()
  const parts = value.split(" ")
  if (parts.length > 64) throw malformed()
  for (let index = 0; index < parts.length; index += 2) {
    if (integer(parts[index]) === 0) throw malformed()
    integer(parts[index + 1])
  }
  return parts.length / 2
}

const keyspaceCounts = (values) => {
  let keys = 0
  let expiringKeys = 0
  for (const [database, value] of values) {
    if (!/^db(?:0|[1-9][0-9]{0,5})$/u.test(database)) throw malformed()
    const fields = new Map()
    for (const part of value.split(",")) {
      const [key, count, extra] = part.split("=")
      if (
        !["keys", "expires", "avg_ttl", "subexpiry"].includes(key) ||
        fields.has(key) ||
        extra !== undefined
      )
        throw malformed()
      fields.set(key, integer(count))
    }
    for (const key of ["keys", "expires", "avg_ttl"])
      if (!fields.has(key)) throw malformed()
    if (fields.get("expires") > fields.get("keys")) throw malformed()
    keys += fields.get("keys")
    expiringKeys += fields.get("expires")
    if (!Number.isSafeInteger(keys) || !Number.isSafeInteger(expiringKeys))
      throw malformed()
  }
  return { keys, expiringKeys, databases: values.size }
}

export const evaluateRedisCapacity = ({ config, info, memoryLimitBytes }) => {
  // Host RAM reported by INFO is not the service/container's reviewed limit.
  if (
    !Number.isSafeInteger(memoryLimitBytes) ||
    memoryLimitBytes < 16 * 1_024 ** 2 ||
    memoryLimitBytes > 16 * 1_024 ** 4
  )
    throw memoryLimitError()
  const source = record(info)
  if (
    Object.keys(source).length !== REDIS_AUDIT_INFO_SECTIONS.length ||
    !REDIS_AUDIT_INFO_SECTIONS.every((section) =>
      Object.hasOwn(source, section)
    )
  )
    throw malformed()
  const sections = new Map(
    REDIS_AUDIT_INFO_SECTIONS.map((section) => [
      section,
      parseInfoSection(source[section]),
    ])
  )
  const settings = parseConfig(config)
  const read = (section, key) => sections.get(section).get(key)
  const count = (section, key) => integer(read(section, key))
  const maxmemoryBytes = integer(settings.get("maxmemory"))
  const evictionPolicy = choice(settings.get("maxmemory-policy"), policyValues)
  const aofEnabled = yesNo(settings.get("appendonly"))
  if (
    maxmemoryBytes !== count("memory", "maxmemory") ||
    evictionPolicy !== read("memory", "maxmemory_policy") ||
    aofEnabled !== flag(read("persistence", "aof_enabled"))
  )
    throw new Error("Redis audit observations are inconsistent")

  const usedBytes = count("memory", "used_memory")
  const excludedBytes = count("memory", "mem_not_counted_for_evict")
  if (excludedBytes > usedBytes) throw malformed()
  const rssBytes = count("memory", "used_memory_rss")
  const countedBytes = usedBytes - excludedBytes
  const fragmentation = read("memory", "mem_fragmentation_ratio")
  if (
    typeof fragmentation !== "string" ||
    !/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,6})?$/u.test(fragmentation)
  )
    throw malformed()
  const mode = choice(read("server", "redis_mode"), [
    "standalone",
    "cluster",
    "sentinel",
  ])
  const role = choice(read("replication", "role"), ["master", "slave"])
  const appendFsync = choice(settings.get("appendfsync"), [
    "everysec",
    "always",
    "no",
  ])
  const fsyncSuppressedDuringRewrite = yesNo(
    settings.get("no-appendfsync-on-rewrite")
  )
  const rdbSaveRuleCount = saveRules(settings.get("save"))
  const loading = flag(read("persistence", "loading"))
  const rdbLastSaveStatus = status(
    read("persistence", "rdb_last_bgsave_status")
  )
  const aofLastRewriteStatus = status(
    read("persistence", "aof_last_bgrewrite_status")
  )
  const aofLastWriteStatus = aofEnabled
    ? status(read("persistence", "aof_last_write_status"))
    : null
  const evictedKeys = count("stats", "evicted_keys")
  const rejectedConnections = count("stats", "rejected_connections")
  const keys = keyspaceCounts(sections.get("keyspace"))
  // Cross-multiply with BigInt so the exact 70% boundary cannot round up.
  const overCapacityBudget =
    BigInt(maxmemoryBytes) * 10n > BigInt(memoryLimitBytes) * 7n
  // 90% RSS is a repository review threshold, not a Redis safety guarantee.
  const rssHeadroomLow = BigInt(rssBytes) * 10n >= BigInt(memoryLimitBytes) * 9n
  const reasons = [
    [mode !== "standalone", "redis_mode_not_standalone"],
    [role !== "master", "redis_role_not_primary"],
    [maxmemoryBytes === 0, "maxmemory_unbounded"],
    [overCapacityBudget, "maxmemory_exceeds_capacity_budget"],
    [evictionPolicy !== "noeviction", "eviction_policy_unsafe"],
    [maxmemoryBytes > 0 && countedBytes >= maxmemoryBytes, "maxmemory_reached"],
    [rssHeadroomLow, "rss_headroom_low"],
    [!aofEnabled, "aof_disabled"],
    [appendFsync !== "everysec", "aof_fsync_policy_mismatch"],
    [fsyncSuppressedDuringRewrite, "aof_fsync_suppressed_during_rewrite"],
    [rdbSaveRuleCount === 0, "rdb_schedule_disabled"],
    [loading, "redis_loading"],
    [rdbLastSaveStatus !== "ok", "rdb_last_save_failed"],
    [aofLastRewriteStatus !== "ok", "aof_last_rewrite_failed"],
    [aofLastWriteStatus === "err", "aof_last_write_failed"],
    [evictedKeys > 0, "historical_evictions_observed"],
    [rejectedConnections > 0, "historical_rejected_connections_observed"],
  ]
    .filter(([failed]) => failed)
    .map(([, reason]) => reason)

  return Object.freeze({
    schemaVersion: 1,
    status: reasons.length === 0 ? "healthy" : "degraded",
    reasons: Object.freeze(reasons),
    memory: Object.freeze({
      serviceLimitBytes: memoryLimitBytes,
      maxmemoryBytes,
      usedBytes,
      countedBytes,
      excludedBytes,
      rssBytes,
      rssHeadroomBytes: Math.max(memoryLimitBytes - rssBytes, 0),
      fragmentationRatio: Number(fragmentation),
    }),
    persistence: Object.freeze({
      mode,
      role,
      aofEnabled,
      appendFsync,
      fsyncSuppressedDuringRewrite,
      rdbSaveRuleCount,
      loading,
      rdbLastSaveStatus,
      rdbLastSaveTimeEpochSeconds: count("persistence", "rdb_last_save_time"),
      rdbSaveInProgress: flag(read("persistence", "rdb_bgsave_in_progress")),
      aofLastRewriteStatus,
      aofLastWriteStatus,
      aofRewriteInProgress: flag(
        read("persistence", "aof_rewrite_in_progress")
      ),
      aofRewriteScheduled: flag(read("persistence", "aof_rewrite_scheduled")),
      aofDelayedFsync: aofEnabled
        ? count("persistence", "aof_delayed_fsync")
        : null,
      aofPendingBioFsync: aofEnabled
        ? count("persistence", "aof_pending_bio_fsync")
        : null,
      rdbLastCowBytes: count("persistence", "rdb_last_cow_size"),
      aofLastCowBytes: count("persistence", "aof_last_cow_size"),
    }),
    stats: Object.freeze({
      evictedKeys,
      rejectedConnections,
      uptimeSeconds: count("server", "uptime_in_seconds"),
      latestForkMicroseconds: count("stats", "latest_fork_usec"),
      keyCount: keys.keys,
      expiringKeyCount: keys.expiringKeys,
      populatedDatabaseCount: keys.databases,
    }),
  })
}
