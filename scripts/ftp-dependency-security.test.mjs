import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { once } from "node:events"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { test } from "node:test"
import { pathToFileURL } from "node:url"

const rootRequire = createRequire(new URL("../package.json", import.meta.url))
const requireThrough = (packages) =>
  packages.reduce(
    (currentRequire, name) => createRequire(currentRequire.resolve(name)),
    rootRequire
  )

// Lighthouse still uses the CommonJS proxy family; browser management uses ESM.
// Exercise both real resolutions rather than an unrelated root dependency.
const consumers = [
  ["browser proxy", ["proxy-agent", "pac-proxy-agent"]],
  [
    "Lighthouse proxy",
    ["@lhci/cli/package.json", "proxy-agent", "pac-proxy-agent"],
  ],
].map(([name, packages]) => {
  const getUriPath = requireThrough(packages).resolve("get-uri")
  return {
    name,
    getUriPath,
    ftpPath: createRequire(getUriPath).resolve("basic-ftp"),
  }
})

const createFtpFixture = async (t, { listFallback = false } = {}) => {
  const servers = new Set()
  const sockets = new Set()
  const commands = []
  const payload = "function FindProxyForURL() { return 'DIRECT'; }\n"
  const trackSocket = (socket) => {
    sockets.add(socket)
    socket.on("error", () => {})
    socket.once("close", () => sockets.delete(socket))
    return socket
  }
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await Promise.all(
      [...servers].map(
        (server) => new Promise((resolve) => server.close(resolve))
      )
    )
  })
  const listen = async (server) => {
    servers.add(server)
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    return server.address().port
  }
  const server = createServer((socket) => {
    trackSocket(socket).setEncoding("utf8")
    socket.write("220 local fixture\r\n")
    let buffer = ""
    let pending = Promise.resolve()
    let dataSocket
    const handle = async (line) => {
      const command = line.split(" ")[0]
      commands.push(command)
      switch (command) {
        case "USER":
          socket.write("331 password required\r\n")
          break
        case "PASS":
          socket.write("230 logged in\r\n")
          break
        case "FEAT":
          socket.write("211-features\r\n MLST type;size;modify;\r\n211 end\r\n")
          break
        case "MDTM":
          socket.write(
            listFallback ? "500 unsupported\r\n" : "213 20260101000000\r\n"
          )
          break
        case "EPSV": {
          let accept
          dataSocket = new Promise((resolve) => {
            accept = resolve
          })
          const port = await listen(
            createServer((connection) => accept(trackSocket(connection)))
          )
          socket.write(`229 entering extended passive mode (|||${port}|)\r\n`)
          break
        }
        case "MLSD":
        case "RETR": {
          socket.write("150 opening transfer\r\n")
          const transfer = await dataSocket
          const content =
            command === "MLSD"
              ? `type=file;size=${Buffer.byteLength(payload)};modify=20260101000000; proxy.pac\r\n`
              : payload
          transfer.end(content, () => socket.write("226 transfer complete\r\n"))
          break
        }
        case "QUIT":
          socket.end("221 goodbye\r\n")
          break
        default:
          socket.write("200 accepted\r\n")
      }
    }
    socket.on("data", (chunk) => {
      buffer += chunk
      let newline = buffer.indexOf("\r\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 2)
        pending = pending.then(() => handle(line)).catch(() => socket.destroy())
        newline = buffer.indexOf("\r\n")
      }
    })
  })
  const port = await listen(server)
  return { url: `ftp://127.0.0.1:${port}/proxy.pac`, commands, payload }
}

for (const consumer of consumers) {
  for (const listFallback of [false, true]) {
    test(`${consumer.name} retrieves FTP PAC content with ${listFallback ? "listing fallback" : "MDTM"}`, {
      timeout: 10_000,
    }, async (t) => {
      const fixture = await createFtpFixture(t, { listFallback })
      const { getUri } = await import(pathToFileURL(consumer.getUriPath).href)
      const stream = await getUri(fixture.url)
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      assert.equal(Buffer.concat(chunks).toString("utf8"), fixture.payload)
      assert.equal(
        stream.lastModified.toISOString(),
        "2026-01-01T00:00:00.000Z"
      )
      assert.ok(fixture.commands.includes("RETR"))
      assert.equal(fixture.commands.includes("MLSD"), listFallback)
      await assert.rejects(getUri(fixture.url, { cache: stream }), {
        code: "ENOTMODIFIED",
      })
      assert.equal(
        fixture.commands.filter((command) => command === "RETR").length,
        1
      )
    })
  }
}

for (const ftpPath of new Set(consumers.map((consumer) => consumer.ftpPath))) {
  test("proxy FTP parser rejects a hostile Unix listing within a bounded child", {
    timeout: 10_000,
  }, () => {
    execFileSync(
      process.execPath,
      [
        "--max-old-space-size=64",
        "--input-type=module",
        "-e",
        `
import assert from "node:assert/strict"
import { createRequire } from "node:module"
const { parseList } = createRequire(import.meta.url)(process.argv[1])
const ordinary = "-rw-r--r-- 1 owner group 42 Jan 1 2020 proxy.pac"
const hostile = "-rw-r--r-- 1 " + "a ".repeat(262_144) + "!"
const files = parseList(hostile + "\\r\\n" + ordinary + "\\r\\n")
assert.equal(files.length, 1)
assert.equal(files[0].name, "proxy.pac")
assert.equal(files[0].size, 42)
`,
        ftpPath,
      ],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 16_384 }
    )
  })

  test("proxy FTP client rejects separate PASV hosts before creating a transfer socket", async () => {
    const { Client, FTPError } = rootRequire(ftpPath)
    const client = new Client()
    let socketAttempts = 0
    const context = {
      socket: { remoteAddress: "127.0.0.1" },
      request: async (command) => {
        if (command === "EPSV")
          throw new FTPError({ code: 500, message: "unsupported" })
        assert.equal(command, "PASV")
        return {
          code: 227,
          message: "227 entering passive mode (192,0,2,1,8,1)",
        }
      },
      log: () => {},
      _newSocket: () => {
        socketAttempts += 1
        throw new Error("fixture forbids outgoing transfer connections")
      },
    }
    try {
      await assert.rejects(
        client.prepareTransfer(context),
        /PASV returned another host/u
      )
      assert.equal(socketAttempts, 0)
    } finally {
      client.close()
    }
  })
}
