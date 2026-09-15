/* global process, console, document, window, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from 'playwright';
const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 2 && args[0] === '--browser'),
  'Usage: test-vue-browser [--browser chromium|firefox|webkit]'
);
const browserName = args[1] ?? 'chromium';
const browserType = { chromium, firefox, webkit }[browserName];
assert(browserType, `Unsupported browser: ${browserName}`);
const require = createRequire(import.meta.url);
const vueRequire = createRequire(resolve('packages/vue/package.json'));
const { createSSRApp, h } = vueRequire('vue');
const { renderToString } = vueRequire('@vue/server-renderer');
const { AIMarkdown } = await import('../packages/vue/dist/index.js');
const markup = await renderToString(
  createSSRApp({ render: () => h(AIMarkdown, { content: '# Hydration\n\n**bold** $x^2$\n\nlocal[^x]\n\n[^x]: body' }) })
);
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const directory = await mkdtemp(join(tmpdir(), 'aimd-vue-browser-'));
let browser, server;
try {
  const bundle = join(directory, 'bundle.js');
  await build({
    entryPoints: ['packages/vue/src/test-fixtures/browser.fixture.ts'],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    nodePaths: [resolve('packages/vue/node_modules')],
    define: {
      'process.env.NODE_ENV': '"development"',
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true',
    },
    logLevel: 'silent',
  });
  const source = await readFile(bundle);
  const css = await readFile('packages/vue/dist/styles.css');
  server = createServer((req, res) => {
    res.setHeader(
      'Content-Type',
      req.url === '/bundle.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html; charset=utf-8'
    );
    res.end(
      req.url === '/bundle.js'
        ? source
        : req.url === '/style.css'
          ? css
          : `<link rel="stylesheet" href="/style.css"><div id="hydration">${markup}</div><div id="app"></div><script type="module" src="/bundle.js"></script>`
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  browser = await browserType.launch({ headless: true });
  const page = await browser.newPage();
  // Reference fixtures use example.com URLs. Serve deterministic image bytes so
  // browser resource diagnostics do not depend on the external example server.
  await page.route('https://example.com/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    })
  );
  // Vue development builds buffer component events while waiting for devtools.
  // A non-retaining hook keeps that diagnostic buffer out of the lifetime test.
  await page.addInitScript(() => {
    window.__VUE_DEVTOOLS_GLOBAL_HOOK__ = { emit() {}, on() {}, once() {}, off() {} };
  });
  const errors = [];
  // The deep raw-HTML case degrades a frame on purpose. A development core
  // entry reports exactly that with the depth diagnostic below (the bundle
  // resolves the production entry, which is silent); only that one message
  // is tolerated, and only while the case runs, so any other engine error
  // during the deep frame still counts as a page error.
  const depthDiagnostic =
    '[ai-react-markdown] raw HTML nested past the engine depth bound — rendering this frame as plain text:';
  let expectDegraded = false;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (expectDegraded && msg.type() === 'error' && msg.text().startsWith(depthDiagnostic)) return;
    if (msg.type() === 'error' || /hydration|recursive updates/i.test(msg.text())) errors.push(msg.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(
    () => window.vueProbe && document.querySelector('#reference a[href="https://example.com/one"]')
  );
  assert.equal(await page.locator('#reference img').getAttribute('src'), 'https://example.com/one');
  assert.equal(await page.locator('#isolated').innerText(), '[label][url]');
  assert.equal(await page.locator('#reference [data-footnotes]').count(), 0);
  assert.equal(await page.locator('#definition [data-footnotes]').count(), 1);
  assert.equal(await page.locator('#reference [data-footnote-ref]').innerText(), '1');
  assert((await page.locator('#reference [data-footnote-ref]').getAttribute('href')).startsWith('/reader#'));
  assert.equal(await page.locator('#reference sup[data-custom="yes"] [data-footnote-ref][data-slot="yes"]').count(), 1);

  assert(await page.locator('#hydration .katex').count());
  await page.evaluate(() =>
    window.vueProbe.update({ definition: '[url]: https://example.com/two\n\n[^x]: updated body' })
  );
  await page.waitForFunction(() => document.querySelector('#reference a[href="https://example.com/two"]'));
  assert((await page.locator('#definition').innerText()).includes('updated body'));
  await page.evaluate(() => window.vueProbe.update({ show: false }));
  await page.waitForFunction(() => !document.querySelector('#reference img'));
  assert((await page.locator('#reference').innerText()).includes('[label][url]'));
  await page.evaluate(() => window.vueProbe.update({ show: true, doc: 'other' }));
  await page.waitForFunction(() => document.querySelector('#reference a[href="https://example.com/two"]'));
  assert((await page.locator('#reference [data-footnote-ref]').getAttribute('href')).includes('other'));
  await page.evaluate(() => window.vueProbe.update({ streaming: false, code: '```ts\nsecond\n```' }));
  await page.waitForFunction(
    () => document.querySelector('#custom output')?.getAttribute('data-streaming') === 'false'
  );
  assert((await page.locator('#custom output').innerText()).includes('second'));
  assert.equal(await page.locator('#custom .aimd-vue-cursor').count(), 0);
  await page.evaluate(() =>
    window.vueProbe.update({ smooth: 'seed followed by an animated tail 👩‍💻', producing: true })
  );
  await page.evaluate(() => window.vueProbe.update({ producing: false }));
  await page.waitForFunction(
    () => document.querySelector('#smooth')?.textContent === 'seed followed by an animated tail 👩‍💻'
  );
  await page.waitForFunction(() => document.querySelector('#queue-second')?.textContent === 'waiting turn');
  await page.evaluate(() => window.vueProbe.update({ first: 'first chunk', second: 'second chunk', secondDone: true }));
  assert.equal(await page.locator('#queue-second').innerText(), 'waiting turn');
  await page.evaluate(() => window.vueProbe.update({ firstDone: true }));
  await page.waitForFunction(() => document.querySelector('#queue-second')?.textContent === 'second chunk');
  await page.waitForFunction(
    () => document.querySelector('#cursor-probe .aimd-vue-cursor')?.style.visibility === 'visible'
  );
  await page.waitForFunction(
    () => document.querySelector('#math-link a')?.getAttribute('href') === 'https://example.com/math'
  );
  assert.equal(await page.locator('#math-ghost').innerText(), 'body[^a]', 'math text must not create a ghost footnote');
  assert.equal(await page.locator('#math-ghost [data-footnote-ref]').count(), 0);
  const cursor = await page.locator('#cursor-probe .aimd-vue-cursor').boundingBox();
  const paragraph = await page.locator('#cursor-probe p').boundingBox();
  assert(
    cursor && paragraph && Math.abs(cursor.y - paragraph.y) < paragraph.height,
    'cursor must occupy the final text line'
  );
  for (const mode of ['ltr', 'rtl', 'scaled']) {
    const selector = `#cursor-border-${mode}`;
    await page.waitForFunction(
      (selector) => document.querySelector(`${selector} .aimd-vue-cursor`)?.style.visibility === 'visible',
      selector
    );
    const offset = await page.locator(selector).evaluate((root) => {
      const text = root.querySelector('p').firstChild;
      const range = document.createRange();
      range.setStart(text, text.textContent.length - 1);
      range.setEnd(text, text.textContent.length);
      const tail = range.getBoundingClientRect();
      const marker = root.querySelector('.aimd-vue-cursor').getBoundingClientRect();
      const rtl = window.getComputedStyle(root).direction === 'rtl';
      return { x: rtl ? marker.right - tail.left : marker.left - tail.right, y: marker.top - tail.top };
    });
    assert(
      Math.abs(offset.x) < 1 && Math.abs(offset.y) < 1,
      `${mode}: borders must not displace the cursor from the final character (${JSON.stringify(offset)})`
    );
  }
  await page.evaluate(() => window.vueProbe.update({ cursor: '[hidden]: https://example.com' }));
  await page.waitForFunction(
    () => document.querySelector('#cursor-probe .aimd-vue-cursor')?.style.visibility === 'hidden'
  );
  await page.evaluate(() => window.vueProbe.update({ cursor: '```ts\ncode tail\n```' }));
  assert.equal(
    await page.locator('#cursor-probe .aimd-vue-cursor').evaluate((node) => node.style.visibility),
    'hidden'
  );
  // Deep raw HTML: thousands of nested <div> tags exceed the engine's
  // nesting bound at the raw-HTML step (and, unbounded, would exhaust the
  // call stack in Vue's mount well before the parser gives out in Firefox
  // or WebKit). The frame must degrade to one escaped plain-text paragraph
  // instead of crashing the subtree, and the next healthy frame must render
  // normally.
  assert.equal(await page.locator('#deep').innerText(), 'shallow start');
  const deep = '<div>'.repeat(3000) + 'x';
  expectDegraded = true;
  await page.evaluate((deep) => window.vueProbe.update({ deep }), deep);
  await page.waitForFunction((deep) => document.querySelector('#deep p')?.textContent === deep, deep);
  assert.equal(await page.locator('#deep div').count(), 0, 'the degraded frame renders escaped text, not markup');
  await page.evaluate(() => window.vueProbe.update({ deep: 'Recovered **frame**' }));
  await page.waitForFunction(() => document.querySelector('#deep strong')?.textContent === 'frame');
  assert.equal(await page.locator('#deep').innerText(), 'Recovered frame');
  expectDegraded = false;
  // Forced-GC ownership assertions use Chromium's collection hook.
  if (browserName === 'chromium') {
    // Keep one provider mounted while repeatedly replacing and releasing documents.
    for (let cycle = 0; cycle < 24; cycle++) {
      const doc = `stress-${cycle}`;
      await page.evaluate(
        (doc) => window.vueStress.update({ show: true, first: true, doc, content: '', tail: '', streaming: true }),
        doc
      );
      let content = '';
      for (let frame = 0; frame < 12; frame++) {
        content += ` frame${frame} 👩‍💻`;
        await page.evaluate((content) => window.vueStress.update({ content, tail: 'queued tail' }), content);
        assert.equal(await page.locator('#stress-waiting').count(), 1, 'successor waits during sustained append');
      }
      if (cycle % 2 === 0) {
        await page.evaluate(() => window.vueStress.update({ streaming: false }));
        await page.waitForFunction(
          (content) => document.querySelector('#stress-first')?.textContent === content.trim(),
          content
        );
      } else {
        // Unmount a producing predecessor with pending animation work.
        await page.evaluate(() => window.vueStress.update({ first: false }));
      }
      await page.waitForFunction(() => document.querySelector('#stress-tail')?.textContent === 'queued tail');
      await page.evaluate(
        (doc) => window.vueStress.update({ doc: `${doc}-switched`, content: 'replacement', streaming: false }),
        doc
      );
      await page.waitForFunction(
        (doc) =>
          document.querySelector('#stress-reference a')?.getAttribute('href') === `https://example.com/${doc}-switched`,
        doc
      );
      if (cycle % 2 === 0)
        await page.waitForFunction(() => document.querySelector('#stress-first')?.textContent === 'replacement');
      // Requeue work immediately before releasing the entire document.
      await page.evaluate(() =>
        window.vueStress.update({ content: 'replacement with a long pending animation '.repeat(20), streaming: true })
      );
      await page.evaluate(() => window.vueStress.update({ show: false }));
      assert.equal(await page.locator('#stress-children').count(), 0);
      assert.equal(
        await page.evaluate(() => window.vueStress.stats().subscriptions),
        0,
        'all document subscriptions are released'
      );
      // Let already-scheduled host callbacks settle before checking ownership.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      for (let collection = 0; collection < 5; collection++) await page.requestGC();
      assert.deepEqual(
        await page.evaluate(() => window.vueStress.stats().alive),
        [],
        'empty document registries/coordinators must be collectible while provider survives'
      );
    }
    assert(
      (await page.evaluate(() => window.vueStress.stats().acquired)) >= 96,
      'stress must exercise real document allocations'
    );
  }
  await page.evaluate(() => window.vueStress.unmount());
  if (browserName === 'chromium')
    console.log(
      'Vue stress: 24 lifecycles, 288 append updates, drain/cancellation, replacement, document switching, zero subscriptions and collectible document state PASS'
    );
  await page.evaluate(() => window.vueProbe.unmount());
  assert.equal(await page.locator('#app .aimd-vue').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    `Vue ${browserName}: hydration, references, isolation, definition removal, document switch, custom components, smooth drain/turn-taking, cursor layout, deep raw HTML degrade/recovery and unmount PASS`
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
