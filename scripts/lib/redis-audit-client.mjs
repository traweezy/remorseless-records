import { createHash } from "node:crypto"
import { isIP } from "node:net"
import {
  REDIS_AUDIT_CONFIG_KEYS,
  REDIS_AUDIT_INFO_SECTIONS,
} from "./redis-capacity-audit.mjs"

const unavailable = () => new Error("Redis capacity audit unavailable.")
const integerInRange = (raw, minimum, maximum) => {
  if (typeof raw !== "string" || !/^[1-9]\d{0,15}$/u.test(raw))
    throw unavailable()
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw unavailable()
  return value
}

export const parseRedisAuditEnvironment = (environment) => {
  const memoryLimitBytes = integerInRange(
    environment.REDIS_SERVICE_MEMORY_LIMIT_BYTES,
    16 * 1024 ** 2,
    16 * 1024 ** 4
  )
  const timeoutMs = integerInRange(
    environment.REDIS_AUDIT_TIMEOUT_MS ?? "5000",
    100,
    30_000
  )
  const raw = environment.REDIS_AUDIT_URL
  if (
    typeof raw !== "string" ||
    raw.length > 4096 ||
    /[?#]/u.test(raw) ||
    /[\s\u0000-\u001f\u007f]/u.test(raw)
  )
    throw unavailable()

  let url
  try {
    url = new URL(raw)
    for (const value of [url.username, url.password]) {
      if (/[\u0000-\u001f\u007f]/u.test(decodeURIComponent(value)))
        throw unavailable()
    }
  } catch {
    throw unavailable()
  }
  const host = url.hostname.toLowerCase()
  const privateHost =
    ["localhost", "127.0.0.1", "[::1]"].includes(host) ||
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+railway\.internal$/u.test(host)
  if (
    !["redis:", "rediss:"].includes(url.protocol) ||
    !host ||
    url.search ||
    url.hash ||
    !["", "/", "/0"].includes(url.pathname) ||
    (url.port && !/^[1-9]\d{0,4}$/u.test(url.port)) ||
    (url.protocol === "redis:" && !privateHost)
  )
    throw unavailable()
  const port = Number(url.port || 6379)
  if (port > 65_535) throw unavailable()
  const socketHost = host.replace(/^\[|\]$/gu, "")

  // Never infer a cgroup/service ceiling from INFO total_system_memory.
  // Socket fields are explicit so URL parsing cannot weaken TLS verification.
  const socket = {
    host: socketHost,
    port,
    connectTimeout: timeoutMs,
    reconnectStrategy: false,
    ...(url.protocol === "rediss:"
      ? {
          tls: true,
          rejectUnauthorized: true,
          ...(isIP(socketHost) === 0 ? { servername: socketHost } : {}),
        }
      : {}),
  }
  return {
    memoryLimitBytes,
    timeoutMs,
    endpointFingerprint: createHash("sha256")
      .update(JSON.stringify([host, port]))
      .digest("hex"),
    clientOptions: {
      socket,
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      RESP: 2,
      disableClientInfo: true,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 8,
    },
  }
}

export const collectRedisAudit = async ({ config, createClient, signal }) => {
  if (signal?.aborted) throw unavailable()
  const controller = new AbortController()
  let client
  let cleanupFailed = false
  const destroy = () => {
    try {
      if (client?.isOpen) client.destroy()
    } catch {
      cleanupFailed = true
    }
  }
  const cancel = () => controller.abort()
  const onError = () => controller.abort()
  const timeout = setTimeout(cancel, config.timeoutMs)
  signal?.addEventListener("abort", cancel, { once: true })
  let onAbort
  try {
    client = createClient({
      ...config.clientOptions,
      socket: {
        ...config.clientOptions.socket,
        // node-redis does not retain its socket until connect/secureConnect.
        // Node's socket signal also closes an in-flight TCP/TLS handshake.
        signal: controller.signal,
      },
    })
    client.on("error", onError)
    const cancellation = new Promise((_, reject) => {
      onAbort = () => {
        // Abort alone only rejects a queued command; destroy closes its socket.
        destroy()
        reject(unavailable())
      }
      controller.signal.addEventListener("abort", onAbort, { once: true })
    })
    const read = async () => {
      await client.connect()
      controller.signal.throwIfAborted()
      const options = { abortSignal: controller.signal }
      const rawConfig = await client.sendCommand(
        ["CONFIG", "GET", ...REDIS_AUDIT_CONFIG_KEYS],
        options
      )
      const info = Object.create(null)
      for (const section of REDIS_AUDIT_INFO_SECTIONS) {
        controller.signal.throwIfAborted()
        info[section] = await client.sendCommand(["INFO", section], options)
      }
      controller.signal.throwIfAborted()
      return { config: rawConfig, info }
    }
    const result = await Promise.race([read(), cancellation])
    destroy()
    if (cleanupFailed || controller.signal.aborted) throw unavailable()
    return result
  } catch {
    throw unavailable()
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", cancel)
    if (onAbort) controller.signal.removeEventListener("abort", onAbort)
    destroy()
    // Keep the fixed, non-logging error listener until any late socket event
    // settles; a closed client and this listener retain no external resource.
  }
}
