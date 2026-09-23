/* global console, process, document, window, navigator, URL */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const consumer = resolve(process.argv[2]);
const fixture = readFileSync(new URL('./fixtures/rich-components.tsx', import.meta.url), 'utf8');
const result = await build({
  stdin: { contents: fixture, resolveDir: consumer, loader: 'tsx', sourcefile: 'rich-components.tsx' },
  bundle: true,
  write: false,
  outdir: join(consumer, 'rich-browser'),
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  metafile: true,
});
// The browser must exercise installed tarballs, never workspace source.
assert(
  Object.keys(result.metafile.inputs)
    .filter((path) => path !== 'rich-components.tsx')
    .every((path) => resolve(path).startsWith(consumer + '/'))
);
const js = result.outputFiles.find((file) => file.path.endsWith('.js')).contents;
const css = result.outputFiles.find((file) => file.path.endsWith('.css')).contents;
const fence = String.fromCharCode(96).repeat(3);
const sample = [
  fence + 'mermaid',
  'graph TD; A-->B',
  fence,
  '',
  'Inline ![plain](/image.svg) image.',
  '',
  '[![linked](/image.svg)](#target)',
  '',
  '| Name | Value |',
  '| - | - |',
  '| [Link](#target) | =SUM(A1) |',
  '| tail | -1.5 |',
].join('\n');
const ssr = JSON.parse(
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import React from 'react'; import { renderToString } from 'react-dom/server';
import { createSSRApp, h, defineComponent } from 'vue'; import { renderToString as renderVue } from '@vue/server-renderer';
import AIMarkdown from '@ai-markdown/react'; import { AIMarkdown as VueMarkdown } from '@ai-markdown/vue';
import * as R from '@ai-markdown/react/components'; import * as V from '@ai-markdown/vue/components';
const content = ${JSON.stringify(sample)};
const components = { pre: R.MarkdownCodeBlock, img: R.MarkdownImage, table: R.MarkdownTable, td: ({ node, children, ...props }) => React.createElement('td', props, children, React.createElement('span', { 'data-ui': true }, 'UI-only')) };
const vc = { pre: V.MarkdownCodeBlock, img: V.MarkdownImage, table: V.MarkdownTable, td: defineComponent({ setup: (_, { attrs, slots }) => () => h('td', attrs, [slots.default?.(), h('span', { 'data-ui': '' }, 'UI-only')]) }) };
process.stdout.write(JSON.stringify({ react: renderToString(React.createElement(AIMarkdown, { content, documentId: 'react-rich', customComponents: components })), vue: await renderVue(createSSRApp({ render: () => h(VueMarkdown, { content, documentId: 'vue-rich', components: vc }) })) }));
`,
    ],
    { cwd: consumer, encoding: 'utf8' }
  )
);
const server = createServer((request, response) => {
  const routes = {
    '/app.js': ['text/javascript', js],
    '/app.css': ['text/css', css],
    '/image.svg': [
      'image/svg+xml',
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#467bcc"/></svg>',
    ],
  };
  const route = routes[request.url];
  response.setHeader('Content-Type', `${route?.[0] ?? 'text/html'}; charset=utf-8`);
  response.end(
    route?.[1] ??
      `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><h1>Rich Markdown components</h1><h2>React</h2><div id="react">${ssr.react}</div><h2>Vue</h2><div id="vue">${ssr.vue}</div><h2>Mantine</h2><div id="mantine"></div><script>window.initialSource=${JSON.stringify(sample)}</script><script type="module" src="/app.js"></script></body></html>`
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
const page = await context.newPage();
const diagnostics = [];
page.on('pageerror', (error) => diagnostics.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') diagnostics.push(message.text());
});
let checks = 0;
const check = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
try {
  await page.goto(url);
  for (const framework of ['react', 'vue']) {
    console.log(`Checking ${framework} rich components`);
    const root = page.locator(`#${framework}`);
    await root.locator('.aimd-diagram svg').waitFor();
    check(await root.locator('a .aimd-image-trigger').count(), 0, 'linked images stay links');
    const trigger = root.getByRole('button', { name: 'Preview image: plain' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.locator('dialog[open]').waitFor();
    check(await page.locator('p dialog').count(), 0, 'dialog is portalled outside paragraphs');
    check(await page.evaluate(() => document.body.style.overflow), 'hidden', 'preview locks background scrolling');
    await page.getByRole('button', { name: 'Original size', exact: true }).click();
    check(
      await page.getByRole('button', { name: 'Fit image', exact: true }).getAttribute('aria-pressed'),
      'true',
      'original/fit view'
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    check(await page.evaluate(() => document.body.style.overflow), '', 'closing restores scrolling');
    check(await trigger.evaluate((node) => node === document.activeElement), true, 'Escape restores focus');
    await trigger.evaluate((node) => node.parentElement.setAttribute('role', 'link'));
    await page.waitForFunction((fw) => !document.querySelector(`#${fw} .aimd-image-trigger`), framework);
    checks++;
    await root.locator('[role=link]').evaluate((node) => node.removeAttribute('role'));
    await trigger.waitFor();
    await root.getByRole('button', { name: 'Copy table', exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check(
      copied,
      "Name\tValue\r\nLink\t'=SUM(A1)\r\ntail\t-1.5",
      'clipboard uses semantic snapshot, excludes custom UI'
    );
    const downloadPromise = page.waitForEvent('download');
    await root.getByRole('button', { name: 'Download CSV' }).click();
    const download = await downloadPromise;
    const csv = readFileSync(await download.path(), 'utf8');
    check(csv, "\uFEFFName,Value\r\nLink,'=SUM(A1)\r\ntail,-1.5", 'real CSV download');
    await root.getByRole('button', { name: 'Show source' }).click();
    check(await root.locator('.aimd-code pre').innerText(), 'graph TD; A-->B\n', 'raw source');
    await root.getByRole('button', { name: 'Copy code', exact: true }).click();
    check(await page.evaluate(() => navigator.clipboard.readText()), 'graph TD; A-->B\n', 'copy uses raw source');
    await page.evaluate((fw) => window[fw === 'react' ? 'modeReact' : 'modeVue']('custom'), framework);
    await root.locator('[data-custom]').waitFor();
    const update = async (code, streaming = false) =>
      page.evaluate(
        ({ fw, code, streaming }) => window[fw === 'react' ? 'updateReact' : 'updateVue'](code, streaming),
        { fw: framework, code, streaming }
      );
    await update('```mermaid\ngraph TD; X-->Y\n```', true);
    await page.waitForFunction(
      (fw) => document.querySelector(`#${fw} [data-custom]`)?.getAttribute('data-streaming') === 'true',
      framework
    );
    await update('```mermaid\ngraph TD; X-->Y\n```', false);
    await page.waitForFunction(
      (fw) => document.querySelector(`#${fw} [data-custom]`)?.getAttribute('data-streaming') === 'false',
      framework
    );
    checks++;
    await page.evaluate((fw) => window[fw === 'react' ? 'modeReact' : 'modeVue']('disabled'), framework);
    await root.locator('.aimd-code pre').waitFor();
    check(await root.locator('[data-custom],.aimd-diagram').count(), 0, 'false disables Mermaid');
    await page.evaluate((fw) => window[fw === 'react' ? 'modeReact' : 'modeVue']('default'), framework);
    await root.locator('.aimd-diagram svg').waitFor();
    await update('```mermaid\ninvalid diagram final\n```');
    await root.getByRole('button', { name: 'Retry diagram' }).waitFor();
    await update('```mermaid\ngraph TD; Done-->OK\n```');
    await root.locator('.aimd-diagram svg').waitFor();
    checks++;
    await update('Inline ![plain](/image.svg) image.');
    await trigger.waitFor();
    await trigger.click();
    await page.locator('dialog[open]').waitFor();
    await update('Inline ![changed](/image.svg?v=2) image.');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    checks++;
    // Ready/loading/error surfaces and gallery navigation use installed adapters.
    await page.route('**/pending.svg', () => {});
    await page.route('**/broken.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: 'not an image' }));
    await page.evaluate((fw) => window[fw === 'react' ? 'modeReact' : 'modeVue']('icons'), framework);
    await update('![first](/image.svg)\n\n![second](/image.svg)\n\n![pending](/pending.svg)\n\n![broken](/broken.svg)');
    await root.locator('[data-custom-icon="gallery"]').first().waitFor({ state: 'attached' });
    await root.locator('[data-custom-icon="error"]').waitFor();
    await root.locator('[data-custom-icon="loading"]').waitFor();
    check(
      await root.locator('.aimd-image[data-status="error"] button').isDisabled(),
      true,
      'broken images cannot open preview'
    );
    check(
      await root.locator('.aimd-image[data-status="loading"] button').isDisabled(),
      true,
      'loading images cannot open preview'
    );
    await root.getByRole('button', { name: 'Preview image: first', exact: true }).click();
    await page.locator('dialog[open]').waitFor();
    check(
      await page.locator('dialog[open] [role="status"]').first().textContent(),
      '1 / 2',
      'gallery excludes pending, failed and other Markdown roots'
    );
    await page.getByRole('button', { name: 'Next image', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('dialog[open]')?.getAttribute('aria-label') === 'second');
    await page.waitForFunction(() => {
      const img = document.querySelector('dialog[open] img');
      return img?.complete && img.naturalWidth > 0 && img.style.visibility === 'visible';
    });
    check(
      await page.getByRole('button', { name: 'Next image', exact: true }).isDisabled(),
      true,
      'gallery stops at the last image'
    );
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('dialog[open]')?.getAttribute('aria-label') === 'first');
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Rotate image', exact: true }).click();
    check(
      await page.locator('dialog[open] img').evaluate((img) => img.style.transform),
      'rotate(90deg) scale(1.25)',
      'preview zoom and rotation'
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    check(
      await root
        .getByRole('button', { name: 'Preview image: first', exact: true })
        .evaluate((node) => node === document.activeElement),
      true,
      'gallery restores the opening trigger'
    );
    await update('![first](/image.svg)');
    await root.locator('[data-custom-icon="preview"]').waitFor({ state: 'attached' });
    check(
      await root.locator('[data-custom-icon="gallery"]').count(),
      0,
      'removing images restores the single-image icon'
    );
    await page.unroute('**/pending.svg');
    await page.unroute('**/broken.svg');
  }
  const mantineTrigger = page.locator('#mantine').getByRole('button', { name: 'Preview image: mantine' });
  await mantineTrigger.click();
  await page.getByRole('dialog', { name: 'mantine', exact: true }).waitFor();
  check(await page.locator('dialog[open]').count(), 0, 'Mantine Modal owns the preview without a nested native dialog');
  await page.getByRole('button', { name: 'Original size', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'mantine', exact: true }).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Preview image: mantine');
  checks++;
  if (process.argv.includes('--inspect')) {
    await page.evaluate(() => {
      window.updateReact(window.sample);
      window.updateVue(window.sample);
    });
    await page.locator('#react .aimd-diagram svg').waitFor();
    await page.locator('#vue .aimd-diagram svg').waitFor();
    console.log(`Inspect rich components at ${url}`);
  }
  check(diagnostics, [], 'no runtime errors or hydration/nesting diagnostics');
  console.log(
    `Rich components: ${checks} packed browser checks passed (React + Vue, real clipboard/download, Mermaid, keyboard).`
  );
} finally {
  await context.close();
  await browser.close();
  if (!process.argv.includes('--inspect')) await new Promise((resolve) => server.close(resolve));
}
