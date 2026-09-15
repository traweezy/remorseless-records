import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  assertClientPlatform,
  clientLauncher,
  downloadBounded,
  postgresClientPolicy,
  provisionPostgresClient,
  removeEmptyReservation,
  signedPackageIndex,
  verifyPackageIndex,
  verifyPinnedBytes,
  verifySignatureStatus,
} from "./provision-postgres-recovery-client.mjs"

const checksum = "a".repeat(64)
const release = `Codename: noble-pgdg\nSHA256:\n ${checksum} 123 main/binary-amd64/Packages.gz\nSHA512:\n ignored\n`
const index = postgresClientPolicy.packages
  .map(
    (pin) =>
      `Package: ${pin.name}\nVersion: ${postgresClientPolicy.version}\nArchitecture: amd64\nFilename: pool/main/p/postgresql-18/${pin.name}_${postgresClientPolicy.version}_amd64.deb\nSize: ${pin.bytes}\nSHA256: ${pin.sha256}\nDescription: fixture\n continuation\n`
  )
  .join("\n")
const validSignature = `[GNUPG:] VALIDSIG ${postgresClientPolicy.fingerprint} 2026-09-14 1 0 4 0 1 10 01 ${postgresClientPolicy.fingerprint}\n`

test("accepts the signed SHA256 index and exact reviewed package metadata", () => {
  assert.deepEqual(signedPackageIndex(release), {
    bytes: 123,
    sha256: checksum,
  })
  assert.equal(verifyPackageIndex(index).length, 2)
  verifySignatureStatus(validSignature)
})

for (const [name, source] of [
  ["different suite", release.replace("noble-pgdg", "resolute-pgdg")],
  ["different architecture", release.replace("amd64", "arm64")],
  [
    "duplicate index",
    release.replace(
      "SHA512:",
      ` ${checksum} 123 main/binary-amd64/Packages.gz\nSHA512:`
    ),
  ],
  ["oversized index", release.replace("123", "99999999999")],
  ["missing hash section", release.replace("SHA256", "SHA1")],
  ["duplicate hash section", release + "SHA256:\n"],
])
  test(`rejects signed release metadata with ${name}`, () =>
    assert.throws(() => signedPackageIndex(source)))

for (const [name, source] of [
  [
    "different version",
    index.replaceAll(postgresClientPolicy.version, "18.7-1.pgdg24.04+1"),
  ],
  [
    "different architecture",
    index.replaceAll("Architecture: amd64", "Architecture: arm64"),
  ],
  [
    "changed hash",
    index.replace(postgresClientPolicy.packages[0].sha256, checksum),
  ],
  ["changed size", index.replace("Size: 264072", "Size: 1")],
  ["path traversal", index.replace("Filename: pool/", "Filename: ../../pool/")],
  ["duplicate record", `${index}\n${index}`],
  [
    "duplicate field",
    index.replace(
      "Architecture: amd64",
      "Architecture: amd64\nArchitecture: amd64"
    ),
  ],
  ["missing package", index.slice(index.indexOf("\n\n") + 2)],
])
  test(`rejects package metadata with ${name}`, () =>
    assert.throws(() => verifyPackageIndex(source)))

test("does not accept an unsigned status, another signer, duplicate signatures, or signature errors", () => {
  for (const source of [
    "",
    validSignature.replaceAll(postgresClientPolicy.fingerprint, "0".repeat(40)),
    validSignature + validSignature,
    ...["BADSIG", "ERRSIG", "REVKEYSIG", "EXPKEYSIG", "EXPSIG"].map(
      (kind) => `${validSignature}[GNUPG:] ${kind} bad\n`
    ),
  ])
    assert.throws(() => verifySignatureStatus(source))
})

test("independently pins downloaded key and package bytes", () => {
  const bytes = Buffer.from("exact reviewed bytes")
  const pin = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
  assert.equal(verifyPinnedBytes(bytes, pin), bytes)
  assert.throws(() => verifyPinnedBytes(Buffer.from("changed bytes"), pin))
  assert.throws(() =>
    verifyPinnedBytes(bytes, { ...pin, bytes: bytes.length - 1 })
  )
})

test("download checks response status, redirect policy, declared size, streamed size and cancellation", async () => {
  const signal = AbortSignal.timeout(3000)
  let options
  const fetcher = async (_url, input) => {
    options = input
    return new Response("abc")
  }
  assert.equal(
    (
      await downloadBounded(
        "https://fixture.invalid",
        { signal, maxBytes: 3 },
        fetcher
      )
    ).toString(),
    "abc"
  )
  assert.deepEqual(options, { signal, redirect: "error" })
  for (const response of [
    new Response("", { status: 302 }),
    new Response("abcd"),
    new Response("a", { headers: { "content-length": "4" } }),
    new Response("a", { headers: { "content-length": "invalid" } }),
  ])
    await assert.rejects(
      downloadBounded(
        "https://fixture.invalid",
        { signal, maxBytes: 3 },
        async () => response
      )
    )
  await assert.rejects(
    downloadBounded(
      "https://fixture.invalid",
      { signal: AbortSignal.abort(), maxBytes: 3 },
      fetcher
    )
  )
})

test("restricts package ABI to Ubuntu 24.04 amd64 and compatible noble derivatives", () => {
  const ubuntu = 'ID=ubuntu\nVERSION_ID="24.04"\n'
  assertClientPlatform(ubuntu, "linux", "x64")
  assertClientPlatform(
    'ID=tuxedo\nID_LIKE="ubuntu debian"\nVERSION_ID="24.04"\nUBUNTU_CODENAME=noble\n',
    "linux",
    "x64"
  )
  for (const [source, platform, arch] of [
    [ubuntu.replace("24.04", "26.04"), "linux", "x64"],
    [ubuntu, "darwin", "x64"],
    [ubuntu, "linux", "arm64"],
    [ubuntu.replace("ubuntu", "debian"), "linux", "x64"],
  ])
    assert.throws(() => assertClientPlatform(source, platform, arch))
})

test("early HTTP rejection cancels an otherwise open response body", async () => {
  for (const options of [
    { status: 500 },
    { headers: { "content-length": "9999" } },
  ]) {
    let cancelled = false
    const body = new ReadableStream({
      cancel: () => {
        cancelled = true
      },
    })
    await assert.rejects(
      downloadBounded(
        "https://fixture.invalid",
        { signal: AbortSignal.timeout(1000), maxBytes: 3 },
        async () => new Response(body, options)
      )
    )
    assert.equal(cancelled, true)
  }
})

test("failed publication removes only its unchanged empty reservation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pg-reservation-"))
  const output = join(directory, "reserved")
  try {
    await mkdir(output)
    const initial = await lstat(output)
    await removeEmptyReservation(output, initial)
    await assert.rejects(lstat(output), { code: "ENOENT" })
    await removeEmptyReservation(output, initial)
    await mkdir(output)
    const populated = await lstat(output)
    await writeFile(join(output, "sentinel"), "preserve")
    await removeEmptyReservation(output, populated)
    assert.equal(await readFile(join(output, "sentinel"), "utf8"), "preserve")
    await rename(output, join(directory, "moved"))
    await mkdir(output)
    await removeEmptyReservation(output, populated)
    assert.ok((await lstat(output)).isDirectory())
    const replaced = await lstat(output)
    await rename(output, join(directory, "also-moved"))
    await symlink(join(directory, "moved"), output)
    await removeEmptyReservation(output, replaced)
    assert.ok((await lstat(output)).isSymbolicLink())
    assert.equal(await readFile(join(output, "sentinel"), "utf8"), "preserve")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("exec launcher preserves arguments, child PID and exact private library selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pg-launcher-"))
  const root = join(directory, "tools with 'quote' and $(literal)")
  try {
    const binaries = join(root, "usr/lib/postgresql/18/bin")
    await mkdir(binaries, { recursive: true })
    await writeFile(
      join(binaries, "pg_dump"),
      `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2),pid:process.pid,library:process.env.LD_LIBRARY_PATH}))`,
      { mode: 0o700 }
    )
    const wrapper = join(directory, "pg_dump")
    await writeFile(wrapper, clientLauncher(root, "pg_dump"), { mode: 0o700 })
    const args = ["space name", "quote'\"", "$(literal)", "line\nbreak"]
    const child = spawn(wrapper, args, { stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", (chunk) => {
      output += chunk
    })
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", resolve)
    })
    assert.equal(code, 0)
    assert.deepEqual(JSON.parse(output), {
      args,
      pid: child.pid,
      library: join(root, "usr/lib/x86_64-linux-gnu"),
    })
    assert.throws(() => clientLauncher(root, "unreviewed-tool"))
    assert.throws(() => clientLauncher("relative/path", "pg_dump"))
    assert.throws(() => clientLauncher("/tmp/new\nline", "pg_dump"))
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("existing output is never overwritten or deleted when provisioning refuses it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pg-provision-owned-"))
  try {
    await writeFile(join(directory, "sentinel"), "must remain")
    await assert.rejects(provisionPostgresClient(directory))
    assert.equal(
      await readFile(join(directory, "sentinel"), "utf8"),
      "must remain"
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("a refused download cleans private staging and only the owned empty output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pg-provision-failure-"))
  const output = join(directory, "clients")
  try {
    let cancelled = false
    await assert.rejects(
      provisionPostgresClient(output, {
        fetcher: async () =>
          new Response(
            new ReadableStream({
              cancel: () => {
                cancelled = true
              },
            }),
            { status: 503 }
          ),
      })
    )
    assert.equal(cancelled, true)
    assert.deepEqual(await readdir(directory), [])
    await assert.rejects(
      provisionPostgresClient(output, {
        fetcher: async () => {
          await writeFile(join(output, "other-owner-content"), "preserve")
          throw new Error("fixture network failure")
        },
      })
    )
    assert.deepEqual(await readdir(directory), ["clients"])
    assert.equal(
      await readFile(join(output, "other-owner-content"), "utf8"),
      "preserve"
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
