import { createServer, type RequestListener, type Server } from "node:http"
import { createNewsLostReplyTransport } from "../../../integration-tests/helpers/news-command-transport"

const withNative = async (
  handler: RequestListener,
  run: (origin: string) => Promise<void>
) => {
  const native: Server = createServer(handler)
  await new Promise<void>((done) => native.listen(0, "127.0.0.1", done))
  const address = native.address()
  if (!address || typeof address === "string") throw new Error("Missing port")
  try {
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    native.closeAllConnections()
    await new Promise<void>((done, reject) =>
      native.close((error) => (error ? reject(error) : done()))
    )
  }
}

describe("owned News transport destination", () => {
  it("rejects a redirect before sending an owned header to another path", async () => {
    const paths: string[] = []
    await withNative(
      (request, response) => {
        paths.push(request.url ?? "")
        response.writeHead(302, { location: "/not-owned" }).end()
      },
      async (nativeOrigin) => {
        const transport = await createNewsLostReplyTransport({
          nativeOrigin,
          entryId: "news_owned",
          headers: { "x-owned-fixture": "unit-only" },
          dropSuccesses: 1,
        })
        try {
          const reply = await fetch(`${transport.backendOrigin}/admin/users/me`)
          expect(reply.status).toBe(502)
          expect(paths).toEqual(["/admin/users/me"])
          expect(transport.snapshot().failures).toHaveLength(1)
        } finally {
          await transport.close()
        }
        expect(transport.snapshot().openSockets).toBe(0)
      }
    )
  })

  it("denies alternate request targets and forwards only the initialized actor", async () => {
    const paths: string[] = []
    await withNative(
      (request, response) => {
        paths.push(request.url ?? "")
        response.writeHead(401, { "content-type": "application/json" })
        response.end('{"message":"native unauthorized"}')
      },
      async (nativeOrigin) => {
        const transport = await createNewsLostReplyTransport({
          nativeOrigin,
          entryId: "news_owned",
          headers: {},
          dropSuccesses: 1,
        })
        try {
          for (const path of [
            "/admin/users/me?alternate=1",
            "/admin/news/news_other",
          ])
            expect(
              (await fetch(`${transport.backendOrigin}${path}`)).status
            ).toBe(400)
          const reply = await fetch(`${transport.backendOrigin}/admin/users/me`)
          expect(reply.status).toBe(401)
          expect(await reply.json()).toEqual({ message: "native unauthorized" })
          expect(paths).toEqual(["/admin/users/me"])
        } finally {
          await transport.close()
        }
        expect(transport.snapshot().openedSockets).toBe(
          transport.snapshot().closedSockets
        )
      }
    )
  })
})
