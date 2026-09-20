import assert from "node:assert/strict"

// Fixed projection only: never select query text, database/role names, or
// arbitrary settings values. The live runner binds this read to one source.
export const observabilityPreflightSql = `
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5000ms';
SET LOCAL lock_timeout = '1000ms';
SET LOCAL idle_in_transaction_session_timeout = '6000ms';
SET LOCAL search_path = pg_catalog;
SELECT pg_catalog.json_build_object(
  'schemaVersion', 1,
  'serverMajor', pg_catalog.current_setting('server_version_num')::integer / 10000,
  'pgStatStatementsPreloaded', coalesce((
    SELECT pg_catalog.bool_or(
      pg_catalog.regexp_replace(
        pg_catalog.btrim(library, ' "'), '^.*/', ''
      ) IN ('pg_stat_statements', 'pg_stat_statements.so')
    )
    FROM pg_catalog.unnest(pg_catalog.string_to_array(
      pg_catalog.current_setting('shared_preload_libraries'), ','
    )) AS libraries(library)
  ), false),
  'pgStatStatementsInstalled', EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_stat_statements'
  ),
  'slowQueryThresholdMs', (
    SELECT setting::integer FROM pg_catalog.pg_settings
    WHERE name = 'log_min_duration_statement' AND unit = 'ms'
  ),
  'trackIoTiming', pg_catalog.current_setting('track_io_timing')::boolean,
  'trackWalIoTiming', pg_catalog.current_setting('track_wal_io_timing')::boolean,
  'computeQueryId', pg_catalog.current_setting('compute_query_id'),
  'databaseCounters', (
    SELECT pg_catalog.json_build_object(
      'connections', numbackends,
      'deadlocks', deadlocks,
      'tempFiles', temp_files,
      'blockReadMs', blk_read_time,
      'blockWriteMs', blk_write_time
    ) FROM pg_catalog.pg_stat_database
    WHERE datname = pg_catalog.current_database()
  )
);
COMMIT;
`

const exactKeys = (value, keys) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort())
}

const nonnegativeCount = (value) => Number.isSafeInteger(value) && value >= 0

// Reject every unexpected field before the CLI can serialize it. In
// particular, psql errors and SQL text must never become report content.
export const parseObservabilityPreflightOutput = (raw) => {
  try {
    assert.equal(typeof raw, "string")
    assert.ok(Buffer.byteLength(raw, "utf8") <= 4096)
    assert.ok(raw.length > 0 && !raw.includes("\n"))
    const value = JSON.parse(raw)
    exactKeys(value, [
      "schemaVersion",
      "serverMajor",
      "pgStatStatementsPreloaded",
      "pgStatStatementsInstalled",
      "slowQueryThresholdMs",
      "trackIoTiming",
      "trackWalIoTiming",
      "computeQueryId",
      "databaseCounters",
    ])
    assert.equal(value.schemaVersion, 1)
    assert.ok(Number.isSafeInteger(value.serverMajor))
    assert.ok(value.serverMajor >= 16 && value.serverMajor <= 18)
    for (const key of [
      "pgStatStatementsPreloaded",
      "pgStatStatementsInstalled",
      "trackIoTiming",
      "trackWalIoTiming",
    ])
      assert.equal(typeof value[key], "boolean")
    assert.ok(Number.isSafeInteger(value.slowQueryThresholdMs))
    assert.ok(value.slowQueryThresholdMs >= -1)
    assert.ok(value.slowQueryThresholdMs <= 2_147_483_647)
    assert.ok(["off", "on", "auto", "regress"].includes(value.computeQueryId))
    exactKeys(value.databaseCounters, [
      "connections",
      "deadlocks",
      "tempFiles",
      "blockReadMs",
      "blockWriteMs",
    ])
    for (const key of ["connections", "deadlocks", "tempFiles"])
      assert.ok(nonnegativeCount(value.databaseCounters[key]))
    for (const key of ["blockReadMs", "blockWriteMs"])
      assert.ok(
        typeof value.databaseCounters[key] === "number" &&
          Number.isFinite(value.databaseCounters[key]) &&
          value.databaseCounters[key] >= 0
      )
    return {
      schemaVersion: 1,
      serverMajor: value.serverMajor,
      pgStatStatementsPreloaded: value.pgStatStatementsPreloaded,
      pgStatStatementsInstalled: value.pgStatStatementsInstalled,
      slowQueryThresholdMs: value.slowQueryThresholdMs,
      trackIoTiming: value.trackIoTiming,
      trackWalIoTiming: value.trackWalIoTiming,
      computeQueryId: value.computeQueryId,
      databaseCounters: {
        connections: value.databaseCounters.connections,
        deadlocks: value.databaseCounters.deadlocks,
        tempFiles: value.databaseCounters.tempFiles,
        blockReadMs: value.databaseCounters.blockReadMs,
        blockWriteMs: value.databaseCounters.blockWriteMs,
      },
    }
  } catch {
    throw new Error("Invalid PostgreSQL observability preflight.")
  }
}
