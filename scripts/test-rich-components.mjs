/* global console, process, document, window, navigator, URL, getComputedStyle */
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
page.setDefaultTimeout(15000);
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
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await noScript.newPage();
  await staticPage.goto(url);
  for (const framework of ['react', 'vue']) {
    const firstImage = staticPage.locator(`#${framework} .aimd-image img`).first();
    check(
      await firstImage.evaluate((img) => img.complete && img.naturalWidth > 0 && getComputedStyle(img).opacity === '1'),
      true,
      'SSR images remain visible without hydration'
    );
    check(
      await staticPage.locator(`#${framework} .aimd-image-feedback`).count(),
      0,
      'SSR does not claim a loaded image is still loading'
    );
  }
  await noScript.close();
  await page.goto(url);
  // The default skin is replaceable through CSS in every adapter.
  await page.addStyleTag({ content: '.aimd-image-preview { z-index: 1500; }' });
  for (const framework of ['react', 'vue']) {
    console.log(`Checking ${framework} rich components`);
    const root = page.locator(`#${framework}`);
    await root.locator('.aimd-diagram svg').waitFor();
    check(await root.locator('a .aimd-image-trigger').count(), 0, 'linked images stay links');
    const trigger = root.getByRole('button', { name: 'Preview image: plain' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.locator('.aimd-image-preview[aria-modal="true"]').waitFor();
    check(await page.locator('p dialog').count(), 0, 'dialog is portalled outside paragraphs');
    check(
      await page.locator('.aimd-image-preview').evaluate((node) => getComputedStyle(node).zIndex),
      '1500',
      'business styles can override the preview layer'
    );
    check(
      await page.evaluate(() => getComputedStyle(document.body).overflowY),
      'hidden',
      'preview locks background scrolling'
    );
    await page.locator('.aimd-image-preview-img').waitFor({ state: 'visible' });
    check(await page.getByRole('button', { name: 'Zoom out', exact: true }).isDisabled(), true, 'minimum zoom is 1x');
    check(await page.locator('.aimd-image-preview-actions button').count(), 6, 'reference toolbar has six actions');
    check(
      await page.locator('.aimd-image-preview-close svg').evaluate((node) => node.getBoundingClientRect().width),
      18,
      'preview icons match the reference size'
    );
    check(
      await trigger.locator('.aimd-image-cover svg').evaluate((node) => node.getBoundingClientRect().width),
      24,
      'thumbnail icon keeps its larger size'
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.aimd-image-preview[aria-modal="true"]'));
    check(
      await page.evaluate(() => getComputedStyle(document.body).overflowY),
      'visible',
      'closing restores scrolling'
    );
    check(await trigger.evaluate((node) => node === document.activeElement), true, 'Escape restores focus');
    check(
      await trigger.evaluate((node) => getComputedStyle(node.closest('.aimd-image')).outlineStyle),
      'solid',
      'keyboard dismissal retains the thumbnail focus indicator'
    );
    await trigger.evaluate((node) => node.parentElement.setAttribute('role', 'link'));
    await page.waitForFunction((fw) => !document.querySelector(`#${fw} .aimd-image-trigger`), framework);
    checks++;
    await root.locator('[role=link]').evaluate((node) => node.removeAttribute('role'));
    await trigger.waitFor();
    const setTheme = async (dark) =>
      page.evaluate(
        ({ fw, dark }) => {
          if (fw === 'react') window.themeReact(dark ? 'dark' : 'light');
          else document.querySelector('#vue').setAttribute('data-color-scheme', dark ? 'dark' : 'light');
        },
        { fw: framework, dark }
      );
    await setTheme(true);
    await page.waitForFunction(
      (fw) => getComputedStyle(document.querySelector(`#${fw} .aimd-table`)).color === 'rgb(237, 240, 245)',
      framework
    );
    check(
      await root.locator('.aimd-table').evaluate((node) => getComputedStyle(node).backgroundColor),
      'rgb(34, 40, 49)',
      'dark table has a contrasting surface'
    );
    await setTheme(false);
    await page.waitForFunction(
      (fw) => getComputedStyle(document.querySelector(`#${fw} .aimd-table`)).color === 'rgb(32, 38, 48)',
      framework
    );
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
    await page.locator('.aimd-image-preview[aria-modal="true"]').waitFor();
    await update('Inline ![changed](/image.svg?v=2) image.');
    await page.waitForFunction(() => !document.querySelector('.aimd-image-preview[aria-modal="true"]'));
    checks++;
    // Ready/loading/error surfaces and gallery navigation use installed adapters.
    await page.route('**/pending.svg', () => {});
    await page.route('**/broken.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: 'not an image' }));
    await page.evaluate((fw) => window[fw === 'react' ? 'modeReact' : 'modeVue']('icons'), framework);
    await update('![first](/image.svg)\n\n![second](/image.svg)\n\n![pending](/pending.svg)\n\n![broken](/broken.svg)');
    await root.locator('[data-custom-icon="gallery"]').first().waitFor({ state: 'attached' });
    await root.locator('[data-custom-icon="error"]').waitFor();
    await root.locator('[data-custom-icon="loading"]').waitFor();
    await setTheme(true);
    await page.waitForFunction(
      (fw) =>
        getComputedStyle(document.querySelector(`#${fw} .aimd-image[data-status=error]`)).backgroundColor ===
        'rgb(34, 40, 49)',
      framework
    );
    checks++;
    await setTheme(false);
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
    await page.locator('.aimd-image-preview[aria-modal="true"]').waitFor();
    check(
      await page.locator('.aimd-image-preview-progress').first().textContent(),
      '1 / 2',
      'gallery excludes pending, failed and other Markdown roots'
    );
    await page.getByRole('button', { name: 'Next image', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.aimd-image-preview[aria-modal="true"]')?.getAttribute('aria-label') === 'second'
    );
    await page.waitForFunction(() => {
      const img = document.querySelector('.aimd-image-preview[aria-modal="true"] img');
      return img?.complete && img.naturalWidth > 0 && img.style.visibility === 'visible';
    });
    check(
      await page.getByRole('button', { name: 'Next image', exact: true }).isDisabled(),
      true,
      'gallery stops at the last image'
    );
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(
      () => document.querySelector('.aimd-image-preview[aria-modal="true"]')?.getAttribute('aria-label') === 'first'
    );
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.aimd-image-preview-img')?.style.transform.includes('rotate(90deg)')
    );
    check(
      await page.locator('.aimd-image-preview[aria-modal="true"] img').evaluate((img) => img.style.transform),
      'translate3d(0px, 0px, 0px) scale3d(1.5, 1.5, 1) rotate(90deg)',
      'preview zoom and rotation'
    );
    const previewImage = page.locator('.aimd-image-preview-img');
    await page.getByRole('button', { name: 'Flip horizontally', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.aimd-image-preview-img')?.style.transform.includes('scale3d(-1.5, 1.5, 1)')
    );
    await page.getByRole('button', { name: 'Flip vertically', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.aimd-image-preview-img')?.style.transform.includes('scale3d(-1.5, -1.5, 1)')
    );
    await page.getByRole('button', { name: 'Rotate left', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.aimd-image-preview-img')?.style.transform.includes('rotate(0deg)')
    );
    await previewImage.dblclick();
    await page.waitForFunction(() =>
      document.querySelector('.aimd-image-preview-img')?.style.transform.includes('scale3d(-1, -1, 1)')
    );
    await previewImage.hover();
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(() =>
      document.querySelector('.aimd-image-preview-img')?.style.transform.includes('scale3d(-1.5, -1.5, 1)')
    );
    // A small image returns to the center after dragging, matching upstream.
    await previewImage.hover();
    await page.mouse.down();
    const imageBox = await previewImage.boundingBox();
    await page.mouse.move(imageBox.x + imageBox.width / 2 + 70, imageBox.y + imageBox.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() =>
      document.querySelector('.aimd-image-preview-img')?.style.transform.startsWith('translate3d(0px, 0px, 0px)')
    );
    await page.getByRole('button', { name: 'Next image', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('.aimd-image-preview-img')?.style.transform ===
        'translate3d(0px, 0px, 0px) scale3d(1, 1, 1) rotate(0deg)'
    );
    // Exercise real touch dispatch: expand, shrink below the minimum, then rebound.
    await previewImage.waitFor({ state: 'visible' });
    const touchBox = await previewImage.boundingBox();
    const center = { x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 };
    const touchSession = await context.newCDPSession(page);
    const touches = (offset) => [
      { x: center.x - offset, y: center.y, id: 0 },
      { x: center.x + offset, y: center.y, id: 1 },
    ];
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(20) });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(40) });
    await page.waitForFunction(() =>
      document.querySelector('.aimd-image-preview-img')?.style.transform.includes('scale3d(2, 2, 1)')
    );
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(10) });
    await page.waitForFunction(() =>
      document.querySelector('.aimd-image-preview-img')?.style.transform.includes('scale3d(0.5, 0.5, 1)')
    );
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() =>
      document.querySelector('.aimd-image-preview-img')?.style.transform.includes('scale3d(1, 1, 1)')
    );
    await touchSession.detach();
    checks += 3;
    // The keyboard cannot move focus into the background while the preview is open.
    for (let tab = 0; tab < 10; tab++) await page.keyboard.press('Tab');
    check(
      await page.evaluate(() => Boolean(document.activeElement?.closest('.aimd-image-preview'))),
      true,
      'focus remains in preview'
    );
    checks += 7;
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.aimd-image-preview[aria-modal="true"]'));
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
    // Reopening and removing an open owner must not retain transforms, portals,
    // scroll locks, listeners, or stale gallery entries during streaming updates.
    const single = root.getByRole('button', { name: 'Preview image: first', exact: true });
    await single.click();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.aimd-image-preview-img')?.style.transform.includes('scale3d(1.5, 1.5, 1)')
    );
    await page.getByRole('button', { name: 'Close preview', exact: true }).click();
    await page.locator('.aimd-image-preview').waitFor({ state: 'detached' });
    check(
      await single.evaluate((node) => getComputedStyle(node.closest('.aimd-image')).outlineStyle),
      'none',
      'pointer dismissal does not leave a keyboard focus indicator'
    );
    await single.click();
    await page.waitForFunction(
      () =>
        document.querySelector('.aimd-image-preview-img')?.style.transform ===
        'translate3d(0px, 0px, 0px) scale3d(1, 1, 1) rotate(0deg)'
    );
    await update('Preview owner removed.');
    await page.locator('.aimd-image-preview').waitFor({ state: 'detached' });
    await page.waitForFunction(() => getComputedStyle(document.body).overflowY === 'visible');
    await page.mouse.move(200, 200);
    await page.mouse.up();
    await update('![replacement](/image.svg)');
    await root.getByRole('button', { name: 'Preview image: replacement', exact: true }).click();
    await page.locator('.aimd-image-preview-img').waitFor({ state: 'visible' });
    check(
      await page.getByRole('button', { name: 'Next image', exact: true }).count(),
      0,
      'removed gallery entries do not survive remount'
    );
    await page.keyboard.press('Escape');
    await page.locator('.aimd-image-preview').waitFor({ state: 'detached' });
    checks += 2;
    await page.unroute('**/pending.svg');
    await page.unroute('**/broken.svg');
  }
  const mantineTrigger = page.locator('#mantine').getByRole('button', { name: 'Preview image: mantine' });
  await mantineTrigger.click();
  await page.getByRole('dialog', { name: 'mantine', exact: true }).waitFor();
  check(await page.locator('dialog[open]').count(), 0, 'Mantine shares the rc-image portal');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
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
