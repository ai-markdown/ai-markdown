import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { chromium, firefox, webkit } from 'playwright';

const names = process.argv.slice(2);
assert(names.length > 0, 'Specify at least one browser to verify');
for (const name of names) {
  const type = { chromium, firefox, webkit }[name];
  assert(type, `Unsupported browser: ${name}`);
  const browser = await type.launch({ headless: true, timeout: 30000 });
  try {
    const page = await browser.newPage();
    await page.setContent('<p>Browser environment ready</p>');
    assert.equal(await page.locator('p').textContent(), 'Browser environment ready');
    console.log(`${name} ${browser.version()}: launch and DOM check passed`);
  } finally {
    await browser.close();
  }
}
