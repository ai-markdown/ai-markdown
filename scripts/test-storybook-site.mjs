/* eslint-disable no-undef */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('storybook-static');
const prefix = '/preview/storybook/';
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    let path = resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)) || '.');
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if ((await stat(path)).isDirectory()) path += '/index.html';
    res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = origin + prefix;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Catalog examples must not download remote images/fonts/scripts.
  page.on('request', (req) => {
    if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== origin)
      errors.push(`External request: ${req.url()}`);
  });
  const react = await (await fetch(base + 'react/index.json')).json();
  const vue = await (await fetch(base + 'vue/index.json')).json();
  // Common capabilities must remain discoverable under identical chapter names.
  const commonChapters = [
    'Playground',
    'Basics/Markdown Basics',
    'Basics/Math',
    'Basics/CJK & International Text',
    'Basics/Footnotes & Definition Lists',
    'Basics/Engine Plugins',
    'Customization/Custom Components',
    'Customization/Rich Components',
    'Customization/Metadata',
    'Customization/URL Sanitization',
    'Customization/Content Preprocessors',
    'Customization/Orphan References',
    'Streaming/Streaming Basics',
    'Streaming/Incremental Parsing',
    'Streaming/Smooth Streaming',
    'Streaming/Streaming Cursor',
    'Streaming/Turn Taking',
    'Streaming/Error Recovery',
    'Documents/Cross-Chunk Coordination',
    'Documents/Definition Lifecycle',
  ];
  const sharedSequence = (index) => [
    ...new Set(
      Object.values(index.entries)
        .filter((entry) => entry.type === 'story' && commonChapters.includes(entry.title))
        .map((entry) => entry.title)
    ),
  ];
  assert.deepEqual(sharedSequence(vue), sharedSequence(react), 'Shared chapter order must match across renderers');
  for (const title of commonChapters) {
    for (const [framework, index] of [
      ['react', react],
      ['vue', vue],
    ]) {
      assert(
        Object.values(index.entries).some((entry) => entry.type === 'story' && entry.title === title),
        `${framework}: shared chapter missing: ${title}`
      );
    }
  }
  for (const [framework, index] of [
    ['react', react],
    ['vue', vue],
  ]) {
    assert(
      Object.values(index.entries).some((entry) => entry.tags.includes('qa')),
      `${framework}: public export must retain QA in its index`
    );
    const entry = Object.values(index.entries).find((e) => e.title === 'Playground' && e.type === 'story');
    assert(entry, `${framework} playground missing`);
    await page.goto(`${base}${framework}/iframe.html?id=${entry.id}&viewMode=story&globals=autoStart:off`);
    await page.locator('#storybook-root table').waitFor({ timeout: 30000 });
    await page.reload();
    await page.locator('#storybook-root table').waitFor({ timeout: 30000 });
    await page.goto(`${base}?path=/story/${framework}_${entry.id}&globals=autoStart:off`);
    await page
      .frameLocator(`iframe[src*="/${framework}/iframe.html"]`)
      .locator('#storybook-root table')
      .waitFor({ timeout: 30000 });
    if (framework === 'vue') {
      const corpus = await readFile('corpus/documents/markdown.md', 'utf8');
      const sample = corpus
        .slice(corpus.indexOf('### block-quotes\n'), corpus.indexOf('### block-thematic-breaks\n'))
        .trim();
      assert(sample.length > 0);
      await page.locator('#control-content').fill(sample);
      const preview = page.frameLocator('iframe[src*="/vue/iframe.html"]');
      await preview.locator('#storybook-root table').waitFor({ state: 'detached' });
      await preview.locator('#storybook-root blockquote').first().waitFor();
      assert.equal(await preview.locator('#storybook-root h3').first().textContent(), 'block-quotes');
    }
  }
  // Public component subentries and the Markdown root must share context in
  // the static build too; development source aliases can hide a duplicate.
  for (const framework of ['react', 'vue']) {
    await page.goto(
      `${base}${framework}/iframe.html?id=customization-rich-components--direct-registration&viewMode=story`
    );
    await page.locator('#storybook-root .aimd-diagram svg').waitFor();
    assert.equal(await page.locator('#storybook-root .aimd-code').count(), 2);
    assert.equal(await page.locator('#storybook-root .aimd-table-scroll table').count(), 1);
    assert.equal(await page.locator('#storybook-root .aimd-image-trigger').count(), 1);
  }
  // Plugin comparisons must read live Controls, not capture their initial source.
  const pluginStory = 'basics-engine-plugins--smartypants';
  await page.goto(`${base}?path=/story/vue_${pluginStory}`);
  await page.frameLocator('iframe[src*="/vue/iframe.html"]').locator('[data-plugin-panel="enabled"]').waitFor();
  const pluginFrame = page.frames().find((frame) => frame.url().includes('/vue/iframe.html'));
  assert(pluginFrame, 'Vue plugin preview frame missing');
  await pluginFrame.waitForFunction(
    (id) =>
      window.__STORYBOOK_PREVIEW__?.storyRenders.some((render) => render.id === id && render.phase === 'finished'),
    pluginStory
  );
  const comparisonSource = (await readFile('corpus/documents/markdown.md', 'utf8'))
    .split('### block-quotes\n')[1]
    .split('### block-thematic-breaks\n')[0]
    .trim();
  assert(comparisonSource.length > 0);
  await page.locator('#control-content').fill(comparisonSource);
  await pluginFrame.waitForFunction(() =>
    ['enabled', 'disabled'].every(
      (panel) =>
        document.querySelector(`[data-plugin-panel="${panel}"] blockquote`) &&
        document.querySelector(`[data-plugin-panel="${panel}"] pre code`)?.textContent?.includes('const x = 1;')
    )
  );
  // Autoplay must leave the context example connected to the public Controls.
  const contextStory = 'customization-metadata--reactive-context';
  await page.goto(`${base}?path=/story/vue_${contextStory}`);
  const contextPreview = page.frameLocator('iframe[src*="/vue/iframe.html"]');
  await contextPreview.locator('[data-context-owner="slot"]').first().waitFor();
  const contextFrame = page.frames().find((frame) => frame.url().includes('/vue/iframe.html'));
  assert(contextFrame, 'Vue context preview frame missing');
  await contextFrame.waitForFunction(
    (id) =>
      window.__STORYBOOK_PREVIEW__?.storyRenders.some((render) => render.id === id && render.phase === 'finished'),
    contextStory
  );
  await page.locator('#control-metadata').fill('Metadata from Controls');
  await contextFrame.waitForFunction(
    () => {
      const links = document.querySelectorAll('[data-context-owner]');
      return (
        ['component', 'slot'].every((owner) => document.querySelector(`[data-context-owner="${owner}"]`)) &&
        Array.from(links).every((link) => link.getAttribute('title') === 'Metadata from Controls')
      );
    },
    undefined,
    { timeout: 5000 }
  );
  // Storybook runs play functions outside Vitest too. The public performance
  // instrument must remain idle until a visitor explicitly starts a measurement.
  await page.goto(`${base}vue/iframe.html?id=performance-lab-dom-update--corpus-commit&viewMode=story`);
  await page.locator('[data-measurement="idle"]').waitFor();
  // Wait through play/afterEach so an automatic click cannot race the idle assertion.
  await page.waitForFunction(() =>
    window.__STORYBOOK_PREVIEW__?.storyRenders.some(
      (render) => render.id === 'performance-lab-dom-update--corpus-commit' && render.phase === 'finished'
    )
  );
  assert.equal(await page.locator('[data-measurement]').getAttribute('data-measurement'), 'idle');
  assert.equal(await page.locator('#storybook-root table').count(), 0);
  await page.getByRole('button', { name: 'Measure corpus update' }).click();
  await page.locator('[data-measurement="complete"]').waitFor();
  await page.locator('#storybook-root table').waitFor();
  const isolated = 'performance-lab-streaming-comparisons--block-memo-side';
  assert(react.entries[isolated], 'Isolated comparison iframe target missing');
  await page.goto(`${base}react/iframe.html?id=${isolated}&viewMode=story&globals=autoStart:off`);
  await page.locator('#storybook-root').waitFor();
  await page.waitForFunction(() => document.querySelector('#storybook-root')?.childElementCount > 0);
  assert.deepEqual(errors, [], 'Static catalogs must load without browser errors or external requests');
  console.log(
    'Storybook static acceptance passed: nested deployment, direct reload, both composed renderers, Vue Controls updates, QA index and isolated iframe.'
  );
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      console.error(
        'Page:',
        page.url(),
        'Frames:',
        page.frames().map((frame) => frame.url())
      );
      console.error((await page.locator('body').innerText()).slice(0, 3000));
    }
  throw error;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
