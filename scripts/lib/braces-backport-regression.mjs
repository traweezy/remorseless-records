export const bracesRegression = `
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
`
