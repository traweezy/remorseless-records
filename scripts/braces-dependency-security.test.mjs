import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { test } from "node:test"
import { dirname, join } from "node:path"
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { verifyBracesBackport } from "./lib/braces-backport.mjs"

const consumers = [
  [
    "Medusa Admin watcher",
    [
      "@medusajs/medusa",
      "@medusajs/admin-bundler",
      "@medusajs/admin-vite-plugin",
      "chokidar",
      "braces",
    ],
  ],
  [
    "Medusa container globbing",
    ["@medusajs/framework", "awilix", "fast-glob", "micromatch", "braces"],
  ],
]

for (const [label, chain] of consumers) {
  const path = chain.reduce(
    (base, name) => createRequire(base).resolve(name),
    new URL("../backend/package.json", import.meta.url)
  )
  test(`${label} bounds string and direct AST nesting without changing ordinary patterns`, {
    timeout: 10_000,
  }, async () => {
    await verifyBracesBackport(await realpath(dirname(path)))
    const output = execFileSync(
      process.execPath,
      [
        "--max-old-space-size=64",
        "-e",
        `
const assert = require('node:assert/strict');
const braces = require(process.argv[1]);
assert.equal(require(require('node:path').join(require('node:path').dirname(process.argv[1]), 'package.json')).version, '3.0.3');
assert.deepEqual(braces.expand('release-{a,b}-{1..2}'), ['release-a-1','release-a-2','release-b-1','release-b-2']);
assert.equal(braces.compile('{src,test}/**/*.{js,ts}'), '(src|test)/**/*.(js|ts)');
assert.equal(braces.stringify(braces.parse('release-{a,b}')), 'release-{a,b}');
const nested = (depth) => '{'.repeat(depth) + 'a,b' + '}'.repeat(depth);
for (const method of ['parse','compile','expand','stringify','create']) {
  for (const pattern of [nested(4500), '('.repeat(4500)+'a'+')'.repeat(4500), '{('.repeat(2000)+'a,b'+')}'.repeat(2000)]) {
    for (const options of [{}, {maxDepth:1e9}, {maxDepth:Infinity}, {maxDepth:NaN}]) {
      assert.throws(() => braces[method](pattern, options), error => error instanceof SyntaxError && /exceeds max depth/.test(error.message));
    }
  }
  assert.doesNotThrow(() => braces[method](nested(100)));
  assert.throws(() => braces[method](nested(101)), /exceeds max depth/);
  assert.doesNotThrow(() => braces[method](nested(2), {maxDepth:2}));
  assert.throws(() => braces[method](nested(2), {maxDepth:1}), /exceeds max depth/);
}

const tree = depth => {
  let node = {type:'text',value:'a'};
  for(let i=0;i<depth;i++) node={type:'brace',nodes:[node]};
  return {type:'root',nodes:[node]};
};
for (const method of ['compile','expand','stringify']) {
  for (const options of [{}, {maxDepth:1e9}, {maxDepth:Infinity}])
    assert.throws(() => braces[method](tree(4500), options), error => error instanceof RangeError && /exceeds max depth/.test(error.message));
  assert.doesNotThrow(() => braces[method](tree(100)));
  assert.throws(() => braces[method](tree(101)), /exceeds max depth/);
}
// Escaped, quoted and bracket-literal delimiters are not syntactic nesting.
for (const pattern of ['\\\\{'.repeat(150), '"'+'{'.repeat(150)+'"', '['+'{'.repeat(150)+']'])
  assert.doesNotThrow(() => braces.parse(pattern, {maxDepth:1}));
assert.throws(() => braces.parse('x'.repeat(10001)), /max characters/);
assert.throws(() => braces.expand('{1..10000}'), /range limit/);
console.log('bounded nesting; ordinary glob and existing limits preserved');
`,
        path,
      ],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 16_384 }
    )
    assert.equal(
      output.trim(),
      "bounded nesting; ordinary glob and existing limits preserved"
    )
  })
}

test("backport integrity rejects modified, oversized and linked package files", async (t) => {
  const original = consumers[1][1].reduce(
    (base, name) => createRequire(base).resolve(name),
    new URL("../backend/package.json", import.meta.url)
  )
  const temporary = await mkdtemp(join(tmpdir(), "rr-braces-integrity-"))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const target = join(temporary, "braces")
  await cp(await realpath(dirname(original)), target, { recursive: true })
  assert.equal((await verifyBracesBackport(target)).verifiedFiles, 8)
  const compile = join(target, "lib", "compile.js")
  const trusted = await readFile(compile)
  await writeFile(
    compile,
    Buffer.concat([trusted, Buffer.from("\n// modified")])
  )
  await assert.rejects(verifyBracesBackport(target))
  await writeFile(compile, Buffer.alloc(65536))
  await assert.rejects(verifyBracesBackport(target))
  await rm(compile)
  await symlink(join(dirname(original), "lib", "compile.js"), compile)
  await assert.rejects(verifyBracesBackport(target))
})
