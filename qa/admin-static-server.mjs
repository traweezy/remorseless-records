import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const defaultRoot = resolve(
  import.meta.dirname,
  "../backend/.medusa/server/public/admin"
)
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
])

const listen = (server, { host, port }) =>
  new Promise((resolveListening, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.off("error", reject)
      resolveListening()
    })
  })

const close = (server) =>
  new Promise((resolveClosed, reject) => {
    server.close((error) => (error ? reject(error) : resolveClosed()))
  })

export const startAdminStaticServer = async ({
  host = "127.0.0.1",
  port = 0,
  root = defaultRoot,
} = {}) => {
  const canonicalRoot = resolve(root)
  if (!existsSync(join(canonicalRoot, "index.html"))) {
    throw new Error(
      "The compiled Medusa Admin is unavailable. Run the Backend build first."
    )
  }

  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://localhost").pathname
    )
    const relative = normalize(pathname)
      .replace(/^\/+/, "")
      .replace(/^app\/assets\//u, "assets/")
    const candidate = join(canonicalRoot, relative)
    let file = join(canonicalRoot, "index.html")
    if (candidate.startsWith(`${canonicalRoot}/`)) {
      try {
        if (statSync(candidate).isFile()) {
          file = candidate
        }
      } catch {
        // SPA routes intentionally fall back to index.html.
      }
    }
    response.setHeader("cache-control", "no-store")
    response.setHeader(
      "content-type",
      contentTypes.get(extname(file)) ?? "application/octet-stream"
    )
    response.setHeader("x-content-type-options", "nosniff")
    createReadStream(file).pipe(response)
  })

  await listen(server, { host, port })
  const address = server.address()
  if (!address || typeof address === "string") {
    await close(server)
    throw new Error("The Admin acceptance server did not bind a TCP address.")
  }
  return {
    baseUrl: `http://${host}:${address.port}`,
    close: () => close(server),
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const port = Number(process.env.ADMIN_ACCEPTANCE_PORT ?? "7002")
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("ADMIN_ACCEPTANCE_PORT must be a valid TCP port.")
  }
  const server = await startAdminStaticServer({ port })
  console.log(`Admin acceptance server listening on ${server.baseUrl}`)
}
