import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { URL } from 'node:url';
import vm from 'node:vm';

// Resolve through real consumers so this checks the installed pnpm patches.
const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve('postcss-cli/package.json'));
const chokidar = createRequire(postcss.resolve('chokidar/package.json'));
const braces = chokidar('braces');
const docs = createRequire(new URL('../apps/docs/package.json', import.meta.url));
const astro = createRequire(docs.resolve('astro/package.json'));
const CachePolicy = astro('http-cache-semantics');

// GHSA-vfj7-8cjw-p6xm: cover strings and caller-supplied ASTs, including
// parentheses, fractional limits and cyclic parent chains from upstream PR #72.
for (const method of ['parse', 'compile', 'expand', 'stringify']) {
  test(`braces.${method} bounds nesting while preserving ordinary patterns`, () => {
    for (const [open, close] of [
      ['{', '}'],
      ['(', ')'],
    ]) {
      const pattern = (depth) => open.repeat(depth) + 'a' + close.repeat(depth);
      assert.doesNotThrow(() => braces[method](pattern(100)));
      assert.throws(() => braces[method](pattern(101)), /exceeds max depth/);
      assert.throws(() => braces[method](pattern(4000)), /exceeds max depth/);
      assert.doesNotThrow(() => braces[method](pattern(1), { maxDepth: 1.5 }));
      assert.throws(() => braces[method](pattern(2), { maxDepth: 1.5 }), /exceeds max depth/);
      assert.throws(() => braces[method](pattern(101), { maxDepth: Infinity }), /exceeds max depth/);
    }
  });
}
for (const method of ['compile', 'expand', 'stringify']) {
  test(`braces.${method} bounds caller-supplied AST depth`, () => {
    let node = { type: 'text', value: 'a' };
    for (let depth = 0; depth < 101; depth++) node = { type: 'brace', nodes: [node] };
    assert.throws(() => braces[method]({ type: 'root', nodes: [node] }), /exceeds max depth/);
  });
}
test('braces preserves expansion and stringify semantics and rejects parent cycles', () => {
  assert.deepEqual(braces.expand('foo/({a,b})'), ['foo/(a)', 'foo/(b)']);
  assert.deepEqual(braces.expand('file-{1..3}'), ['file-1', 'file-2', 'file-3']);
  for (const pattern of ['{{a}}', '{a,{b}}', '{{x}y}', '{a,{b,{c}}', '{}{a}']) {
    assert.equal(braces.stringify(braces.parse(pattern), { escapeInvalid: true }), pattern);
  }
  const ast = { type: 'paren', nodes: [{ type: 'text', value: 'a' }] };
  ast.parent = ast;
  assert.throws(
    () => vm.runInNewContext('braces.expand(ast)', { braces, ast }, { timeout: 1000 }),
    /parent chain contains a cycle/
  );
});

const request = { url: 'https://example.test/account', method: 'GET', headers: { host: 'example.test' } };
const staleRequest = (value) => ({ ...request, headers: { ...request.headers, 'cache-control': value } });
function policy(headers, shared = true) {
  const result = new CachePolicy(request, { status: 200, headers }, { shared });
  const initial = result.now();
  result.now = () => initial + 120_000;
  return result;
}
// GHSA-ch52-4w7c-c8xp: request max-stale and stale-while-revalidate must not
// bypass response reuse restrictions, including after serialized restoration.
for (const headers of [
  { 'cache-control': 'max-age=60', 'set-cookie': 'session=private' },
  { 'cache-control': 'max-age=60, proxy-revalidate' },
  { 'cache-control': 'max-age=60, no-cache' },
  { 'cache-control': 'max-age=60, no-store' },
  { 'cache-control': 'max-age=60, private' },
  { 'cache-control': 'max-age=60, must-revalidate' },
  { 'cache-control': 'max-age=60, stale-while-revalidate=600', 'set-cookie': 'session=private' },
]) {
  test(`cache restrictions survive max-stale: ${JSON.stringify(headers)}`, () => {
    const original = policy(headers);
    const restored = CachePolicy.fromObject(original.toObject());
    restored.now = original.now;
    for (const candidate of [original, restored]) {
      for (const directive of ['max-stale', 'max-stale=999999', '']) {
        const req = staleRequest(directive);
        assert.equal(candidate.satisfiesWithoutRevalidation(req), false);
        const evaluation = candidate.evaluateRequest(req);
        assert.equal(evaluation.response, undefined);
        assert.equal(evaluation.revalidation.synchronous, true);
      }
    }
  });
}
test('ordinary stale reuse, public cookie opt-in and private caches still work', () => {
  for (const candidate of [
    policy({ 'cache-control': 'max-age=60' }),
    policy({ 'cache-control': 'max-age=60, public', 'set-cookie': 'shared=yes' }),
    policy({ 'cache-control': 'max-age=60, immutable', 'set-cookie': 'shared=yes' }),
    policy({ 'cache-control': 'max-age=60', 'set-cookie': 'session=private' }, false),
  ]) {
    assert.equal(candidate.satisfiesWithoutRevalidation(staleRequest('max-stale=600')), true);
  }
  assert.equal(
    policy({ 'cache-control': 'max-age=60' }).satisfiesWithoutRevalidation(staleRequest('max-stale=10')),
    false
  );
});
