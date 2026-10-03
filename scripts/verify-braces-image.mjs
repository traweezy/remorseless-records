import assert from "node:assert/strict"
import { collectBracesProof } from "./lib/braces-backport-proof.mjs"

assert.equal(process.getuid(), 1000)
assert.equal(process.argv.length, 2)
const proof = await collectBracesProof(["/app"], "/")
console.info(JSON.stringify(proof))
