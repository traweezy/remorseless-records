import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import { join, resolve } from "node:path"

export const bracesBackport = Object.freeze({
  advisory: "CVE-2026-93687",
  ghsa: "GHSA-vfj7-8cjw-p6xm",
  approvedAt: "2026-10-03T01:43:00.000Z",
  expiresAt: "2026-11-02T00:00:00.000Z",
  package: "braces",
  version: "3.0.3",
  patchSha256:
    "37f95f7d660c05bfd44d4b429ca49ceeede99dcff68389f81ee9b995a8ea24d2",
  files: Object.freeze({
    "index.js":
      "332ea07c7b006361aad12aa994ca75dc1db8e8382b884909e2f38f10b85c88a4",
    "package.json":
      "56f08b888a4f30dc7cf8a7dbb36ffe92b737912ba36abe9d069d32167c957ac7",
    "lib/constants.js":
      "f9fb688959232eee3e6ad7906a5b0e3234815db49ee857ef86983d65b917dc7c",
    "lib/parse.js":
      "ef9b3851f848460daaf91ff248222a43e266f97c4f2df7010cb7858e1e39a107",
    "lib/compile.js":
      "b651f7715e6db8942ce61d3394357b4d81c8ece88240aa31a458ea1165edd195",
    "lib/expand.js":
      "2974d5b8763a358d81dfa5b4b804329f525239f34429c396b93a540219504809",
    "lib/stringify.js":
      "645f13c68af685148e9fe8eca449ee2ebb88eee0f27de7b2125fbfc175b1584d",
    "lib/utils.js":
      "b5a7596aa67730412b3c029ef09e84e6b67b8e445cffd35d1d295549c89066c7",
  }),
})

// Raw findings remain unchanged. Only the separate, expiring exception gate
// can accept this exact backport after integrity AND behavioral verification.
export const verifyBracesBackport = async (packageRoot) => {
  assert.equal(await realpath(packageRoot), resolve(packageRoot))
  for (const directory of [packageRoot, join(packageRoot, "lib")]) {
    const metadata = await lstat(directory)
    assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink())
  }
  for (const [name, expected] of Object.entries(bracesBackport.files)) {
    const file = await open(
      join(packageRoot, name),
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
    try {
      const before = await file.stat({ bigint: true })
      assert.ok(before.isFile() && before.size > 0n && before.size < 65536n)
      const bytes = Buffer.alloc(Number(before.size) + 1)
      let offset = 0
      while (offset < bytes.length) {
        const result = await file.read(
          bytes,
          offset,
          bytes.length - offset,
          offset
        )
        if (result.bytesRead === 0) break
        offset += result.bytesRead
      }
      assert.equal(offset, Number(before.size))
      const after = await file.stat({ bigint: true })
      for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"])
        assert.equal(after[key], before[key])
      assert.equal(
        createHash("sha256").update(bytes.subarray(0, offset)).digest("hex"),
        expected
      )
    } finally {
      await file.close()
    }
  }
  return {
    package: bracesBackport.package,
    version: bracesBackport.version,
    patchSha256: bracesBackport.patchSha256,
    verifiedFiles: Object.keys(bracesBackport.files).length,
  }
}
