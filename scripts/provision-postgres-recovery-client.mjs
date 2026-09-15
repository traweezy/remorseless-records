import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"
import {
  createRecoveryScope,
  parseRecoveryArguments,
  runRecoveryCommand,
} from "./lib/recovery-process.mjs"

// Verified against PGDG's signed noble-pgdg index on 2026-09-14. Updating a
// package requires reviewing its signed metadata and its independent byte pin.
export const postgresClientPolicy = Object.freeze({
  version: "18.6-1.pgdg24.04+2",
  keyUrl: "https://www.postgresql.org/media/keys/ACCC4CF8.asc",
  signingFileSha256:
    "0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76",
  fingerprint: "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8",
  repository: "https://apt.postgresql.org/pub/repos/apt/",
  suite: "noble-pgdg",
  packages: Object.freeze([
    Object.freeze({
      name: "libpq5",
      bytes: 264072,
      sha256:
        "b487c5ed2ceb9244c6a9d6ae65818ed6707c3c44a2e14488394ae4194c52c53b",
    }),
    Object.freeze({
      name: "postgresql-client-18",
      bytes: 2114236,
      sha256:
        "b9d10d99a73bf7aa375be2fe36626c40499cfdf553d0ad174674a88a1b256b43",
    }),
  ]),
})

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
export const verifyPinnedBytes = (bytes, expected) => {
  if (expected.bytes !== undefined) assert.equal(bytes.length, expected.bytes)
  assert.equal(sha256(bytes), expected.sha256)
  return bytes
}

export const signedPackageIndex = (release) => {
  assert.match(release, /^Codename: noble-pgdg$/mu)
  const sections = release.split(/^SHA256:\n/mu)
  assert.equal(sections.length, 2)
  const rows = sections[1].split(/\n(?=\S)/u)[0].split("\n")
  const matches = rows.flatMap((line) => {
    const match =
      /^ ([a-f0-9]{64}) +(\d+) main\/binary-amd64\/Packages.gz$/u.exec(line)
    return match ? [{ sha256: match[1], bytes: Number(match[2]) }] : []
  })
  assert.equal(matches.length, 1)
  assert.ok(
    Number.isSafeInteger(matches[0].bytes) &&
      matches[0].bytes > 0 &&
      matches[0].bytes <= 8 * 1024 * 1024
  )
  return matches[0]
}

export const verifyPackageIndex = (text) =>
  postgresClientPolicy.packages.map((pin) => {
    const records = text
      .split("\n\n")
      .map((block) => {
        const entries = block.split("\n").flatMap((line) => {
          const match = /^([A-Za-z][A-Za-z0-9-]*): (.*)$/u.exec(line)
          return match ? [[match[1], match[2]]] : []
        })
        const fields = Object.fromEntries(entries)
        if (
          fields.Package === pin.name &&
          fields.Version === postgresClientPolicy.version
        )
          assert.equal(
            new Set(entries.map(([key]) => key)).size,
            entries.length
          )
        return fields
      })
      .filter(
        (record) =>
          record.Package === pin.name &&
          record.Version === postgresClientPolicy.version &&
          record.Architecture === "amd64"
      )
    assert.equal(records.length, 1)
    const filename = `pool/main/p/postgresql-18/${pin.name}_${postgresClientPolicy.version}_amd64.deb`
    assert.equal(records[0].Filename, filename)
    assert.equal(records[0].SHA256, pin.sha256)
    assert.equal(records[0].Size, String(pin.bytes))
    return { ...pin, filename }
  })

export const downloadBounded = async (
  url,
  { signal, maxBytes },
  fetcher = fetch
) => {
  const response = await fetcher(url, { signal, redirect: "error" })
  try {
    assert.equal(response.status, 200)
    assert.ok(response.body)
    const declared = response.headers.get("content-length")
    if (declared !== null)
      assert.ok(/^\d+$/u.test(declared) && Number(declared) <= maxBytes)
    let length = 0
    const chunks = []
    for await (const chunk of response.body) {
      signal.throwIfAborted()
      length += chunk.length
      assert.ok(length <= maxBytes)
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  } catch (error) {
    // Early header/status rejection has not acquired the stream iterator yet.
    // Cancel that body too, so the deadline can close without a live socket.
    await response.body?.cancel().catch(() => {})
    throw error
  }
}

export const removeEmptyReservation = async (path, identity) => {
  try {
    const current = await lstat(path)
    if (
      !current.isDirectory() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino
    )
      return
    await rmdir(path)
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      !["ENOENT", "ENOTEMPTY"].includes(error.code)
    )
      throw error
  }
}

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
export const clientLauncher = (root, tool) => {
  assert.ok(["pg_dump", "pg_restore", "psql"].includes(tool))
  assert.equal(resolve(root), root)
  assert.doesNotMatch(root, /[\r\n\0]/u)
  // exec preserves the recovery supervisor's child PID and signal semantics.
  // Keep libpq private too; an older host libpq cannot satisfy client 18.
  return `#!/bin/sh\nexec /usr/bin/env LD_LIBRARY_PATH=${quote(join(root, "usr/lib/x86_64-linux-gnu"))} ${quote(join(root, "usr/lib/postgresql/18/bin", tool))} "$@"\n`
}

export const assertClientPlatform = (
  release,
  platform = process.platform,
  architecture = process.arch
) => {
  assert.equal(platform, "linux")
  assert.equal(architecture, "x64")
  assert.ok(
    /^ID=ubuntu$/mu.test(release) ||
      (/^ID_LIKE="(?:[^"\n]* )?ubuntu(?: [^"\n]*)?"$/mu.test(release) &&
        /^UBUNTU_CODENAME=noble$/mu.test(release))
  )
  assert.match(release, /^VERSION_ID="24\.04"$/mu)
}

export const verifySignatureStatus = (status) => {
  const signatures = status
    .split("\n")
    .filter((line) => line.startsWith("[GNUPG:] VALIDSIG "))
  assert.equal(signatures.length, 1)
  assert.ok(
    signatures[0].startsWith(
      `[GNUPG:] VALIDSIG ${postgresClientPolicy.fingerprint} `
    )
  )
  assert.doesNotMatch(
    status,
    /\[GNUPG:\] (?:BADSIG|ERRSIG|REVKEYSIG|EXPKEYSIG|EXPSIG) /u
  )
}

export const provisionPostgresClient = async (
  output,
  { fetcher = fetch } = {}
) => {
  assert.equal(resolve(output), output)
  assert.doesNotMatch(output, /[\r\n\0]/u)
  await assertClientPlatform(await readFile("/etc/os-release", "utf8"))
  const parent = dirname(output)
  assert.equal(await realpath(parent), parent)
  const scope = createRecoveryScope(120_000)
  let pending
  let published = false
  let reservation
  try {
    // Exclusive reservation prevents overwriting an existing toolchain or link.
    await mkdir(output, { mode: 0o700 })
    reservation = await lstat(output)
    pending = await mkdtemp(join(parent, ".postgres-client-"))
    const environment = { PATH: "/usr/bin:/bin", LANG: "C" }
    const run = (command, args) =>
      runRecoveryCommand(command, args, {
        environment,
        signal: scope.signal,
        maxOutputBytes: 1024 * 1024,
      })
    const download = (url, maxBytes) =>
      downloadBounded(url, { signal: scope.signal, maxBytes }, fetcher)
    const key = verifyPinnedBytes(
      await download(postgresClientPolicy.keyUrl, 16_384),
      { sha256: postgresClientPolicy.signingFileSha256 }
    )
    await writeFile(join(pending, "key.asc"), key, { mode: 0o600 })
    await mkdir(join(pending, "gnupg"), { mode: 0o700 })
    const keyring = join(pending, "keyring.gpg")
    await run("gpg", [
      "--no-options",
      "--homedir",
      join(pending, "gnupg"),
      "--batch",
      "--dearmor",
      "--output",
      keyring,
      join(pending, "key.asc"),
    ])
    const inRelease = await download(
      `${postgresClientPolicy.repository}dists/${postgresClientPolicy.suite}/InRelease`,
      512 * 1024
    )
    await writeFile(join(pending, "InRelease"), inRelease, { mode: 0o600 })
    const status = await run("gpgv", [
      "--homedir",
      join(pending, "gnupg"),
      "--status-fd=1",
      "--keyring",
      keyring,
      "--output",
      join(pending, "Release"),
      join(pending, "InRelease"),
    ])
    verifySignatureStatus(status)
    const indexPin = signedPackageIndex(
      await readFile(join(pending, "Release"), "utf8")
    )
    const compressed = verifyPinnedBytes(
      await download(
        `${postgresClientPolicy.repository}dists/${postgresClientPolicy.suite}/main/binary-amd64/Packages.gz`,
        indexPin.bytes
      ),
      indexPin
    )
    const packages = verifyPackageIndex(
      gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 }).toString(
        "utf8"
      )
    )
    const unpacked = join(pending, "unpacked")
    await mkdir(unpacked, { mode: 0o700 })
    for (const entry of packages) {
      const file = join(pending, `${entry.name}.deb`)
      await writeFile(
        file,
        verifyPinnedBytes(
          await download(
            `${postgresClientPolicy.repository}${entry.filename}`,
            entry.bytes
          ),
          entry
        ),
        { mode: 0o600 }
      )
      // Extract data only. No root privileges, maintainer scripts, apt state,
      // package dependencies, or network-selected versions are installed.
      await run("dpkg-deb", ["--extract", file, unpacked])
    }
    await mkdir(join(unpacked, "bin"), { mode: 0o700 })
    for (const tool of ["pg_dump", "pg_restore", "psql"]) {
      const check = await run("/usr/bin/env", [
        `LD_LIBRARY_PATH=${join(unpacked, "usr/lib/x86_64-linux-gnu")}`,
        join(unpacked, "usr/lib/postgresql/18/bin", tool),
        "--version",
      ])
      assert.equal(
        check,
        `${tool} (PostgreSQL) 18.6 (Ubuntu ${postgresClientPolicy.version})`
      )
      await writeFile(
        join(unpacked, "bin", tool),
        clientLauncher(output, tool),
        { mode: 0o700 }
      )
    }
    const evidence = {
      schemaVersion: 1,
      status: "verified",
      version: postgresClientPolicy.version,
      signingFingerprint: postgresClientPolicy.fingerprint,
      inReleaseSha256: sha256(inRelease),
      packageIndexSha256: indexPin.sha256,
      packages,
    }
    await mkdir(join(unpacked, "provenance"), { mode: 0o700 })
    for (const [name, bytes] of [
      ["verification.json", `${JSON.stringify(evidence, null, 2)}\n`],
      ["InRelease", inRelease],
      ["Packages.gz", compressed],
      ["key.asc", key],
    ])
      await writeFile(join(unpacked, "provenance", name), bytes, {
        mode: 0o600,
      })
    await chmod(unpacked, 0o700)
    scope.signal.throwIfAborted()
    const destination = await lstat(output)
    assert.equal(destination.dev, reservation.dev)
    assert.equal(destination.ino, reservation.ino)
    await rename(unpacked, output)
    published = true
    return { ...evidence, bin: join(output, "bin") }
  } finally {
    scope.close()
    if (pending) await rm(pending, { recursive: true, force: true })
    // Only remove our empty reservation after a failed provision.
    if (!published && reservation)
      await removeEmptyReservation(output, reservation)
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.slice(2).join(" ") === "--help") {
    process.stdout.write(
      "Usage: provision-postgres-recovery-client --output-dir <new-absolute-directory>\nVerifies signed PGDG metadata and exact PostgreSQL 18.6 Ubuntu 24.04 amd64 package bytes.\nExtracts private clients and libpq without root or package installation scripts.\nRequires gpg, gpgv, dpkg-deb and Ubuntu client runtime libraries; deadline 120 seconds.\nAdd the returned bin directory to PATH for disposable recovery integration only.\n"
    )
  } else {
    try {
      const args = parseRecoveryArguments(process.argv.slice(2), [
        "--output-dir",
      ])
      process.stdout.write(
        `${JSON.stringify(await provisionPostgresClient(args["--output-dir"]))}\n`
      )
    } catch {
      process.stderr.write(
        '{"status":"failed","phase":"postgres_client_provisioning","action":"Review platform, signed PGDG metadata and reviewed package pins; no fallback version is permitted."}\n'
      )
      process.exitCode = 1
    }
  }
}
