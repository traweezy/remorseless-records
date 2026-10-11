import { Client } from "@medusajs/js-sdk"
import { createServer, type IncomingMessage } from "node:http"
import type { Socket } from "node:net"

const MAX_BODY_BYTES = 1_024 * 1_024
const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk)
    length += bytes.length
    if (length > MAX_BODY_BYTES)
      throw new Error("Owned News transport body exceeds its bounded fixture")
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/**
 * An owned loopback transport, not a mocked successful API reply. It forwards
 * the initialized server's exact response, except for the specified number of
 * successful PUTs: those are drained after commit and the downstream socket is
 * closed before any response headers. Tokens remain in this process only.
 */
export const createNewsLostReplyTransport = async ({
  nativeOrigin,
  entryId,
  headers,
  dropSuccesses,
}: {
  nativeOrigin: string
  entryId: string
  headers: Record<string, string>
  dropSuccesses: number
}) => {
  const origin = new URL(nativeOrigin)
  if (
    origin.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(origin.hostname) ||
    !origin.port ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password ||
    !/^news_[A-Za-z0-9]+$/u.test(entryId) ||
    !Number.isSafeInteger(dropSuccesses) ||
    dropSuccesses < 1 ||
    dropSuccesses > 2
  )
    throw new Error("News transport must target the exact owned loopback post")
  const detail = `/admin/news/${entryId}`
  // Incoming URL text must never select the upstream authority or a redirect.
  const actorTarget = new URL("/admin/users/me", origin)
  const entryTarget = new URL(detail, origin)
  const sockets = new Set<Socket>()
  const connectionClosures: Promise<void>[] = []
  const inFlight = new Set<Promise<void>>()
  const puts: string[] = []
  const statuses: number[] = []
  const failures: string[] = []
  const unexpectedRequests: { method: string; path: string }[] = []
  let dropped = 0
  let closedSockets = 0
  let openedSockets = 0
  let actorRequests = 0
  const server = createServer((request, response) => {
    const task = (async () => {
      try {
        if (
          !(
            (request.method === "GET" && request.url === "/admin/users/me") ||
            (request.method === "PUT" && request.url === detail)
          )
        ) {
          unexpectedRequests.push({
            method: request.method ?? "",
            path: request.url ?? "",
          })
          response.writeHead(400).end("Unexpected owned News transport path")
          return
        }
        const body = request.method === "PUT" ? await readBody(request) : null
        if (body !== null) puts.push(body)
        else actorRequests += 1
        const upstream = await fetch(
          request.method === "PUT" ? entryTarget : actorTarget,
          {
            method: request.method,
            redirect: "error",
            headers: {
              ...headers,
              "content-type": "application/json",
              connection: "close",
            },
            ...(body === null ? {} : { body }),
            signal: AbortSignal.timeout(15_000),
          }
        )
        const bytes = Buffer.from(await upstream.arrayBuffer())
        if (request.method === "PUT") {
          statuses.push(upstream.status)
          if (upstream.ok && dropped < dropSuccesses) {
            dropped += 1
            request.socket.destroy()
            return
          }
        }
        response.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") ?? "text/plain",
          "content-length": bytes.length,
          connection: "close",
        })
        response.end(bytes)
      } catch (error) {
        failures.push(error instanceof Error ? error.name : "Unknown error")
        if (!response.headersSent) response.writeHead(502)
        response.end("Owned News transport failed")
      }
    })()
    inFlight.add(task)
    void task.finally(() => inFlight.delete(task))
  })
  server.requestTimeout = 20_000
  server.headersTimeout = 10_000
  server.on("connection", (socket) => {
    sockets.add(socket)
    openedSockets += 1
    connectionClosures.push(
      new Promise<void>((resolve) => {
        socket.once("close", () => {
          sockets.delete(socket)
          closedSockets += 1
          resolve()
        })
      })
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("Owned News transport failed to bind loopback")
  const backendOrigin = `http://127.0.0.1:${address.port}`
  const client = new Client({
    baseUrl: backendOrigin,
    auth: { type: "jwt", jwtTokenStorageMethod: "memory" },
  })
  let closed = false
  return {
    backendOrigin,
    client,
    puts,
    statuses,
    snapshot: () => ({
      dropped,
      actorRequests,
      failures: [...failures],
      unexpectedRequests: [...unexpectedRequests],
      openedSockets,
      closedSockets,
      openSockets: sockets.size,
      inFlight: inFlight.size,
      closed,
    }),
    close: async () => {
      await Promise.all([...inFlight])
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
        for (const socket of sockets) socket.destroy()
      })
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.all(connectionClosures),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    "Owned News transport connection cleanup exceeded two seconds"
                  )
                ),
              2_000
            )
          }),
        ])
      } finally {
        if (timeout) clearTimeout(timeout)
      }
      closed = true
    },
  }
}
