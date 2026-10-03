/* global document */
import { URL } from 'node:url';
import { test, expect } from 'playwright/test';

const base = 'http://127.0.0.1:6108/preview/storybook/';
const cases = [
  ['react-introduction', 'react', 'introduction--docs', 'docs', '.aim-docs-code'],
  ['vue-introduction', 'vue', 'introduction--docs', 'docs', '.aim-docs-code'],
  ['react-markdown', 'react', 'basics-markdown-basics--overview', 'story', '.task-list-item'],
  ['vue-markdown', 'vue', 'basics-markdown-basics--gfm', 'story', '.task-list-item'],
  ['mantine-code', 'react', 'integrations-mantine-code-blocks--json-pretty-print', 'story', '.hljs-string'],
];
for (const [name, framework, id, mode, ready] of cases) {
  for (const theme of ['light', 'dark']) {
    for (const [device, width, height] of [
      ['desktop', 1200, 900],
      ['mobile', 390, 844],
    ]) {
      test(`${name} ${theme} ${device}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/*', (route) => {
          const url = new URL(route.request().url());
          if (url.protocol.startsWith('http') && url.origin !== new URL(base).origin) {
            errors.push(`Unexpected remote asset: ${url}`);
            return route.abort();
          }
          return route.continue();
        });
        await page.goto(
          `${base}${framework}/iframe.html?id=${id}&viewMode=${mode}&globals=theme:${theme};autoStart:off`
        );
        await page.locator(ready).first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await expect(page).toHaveScreenshot(`${name}-${theme}-${device}.png`, { fullPage: true });
        expect(errors).toEqual([]);
      });
    }
  }
}
