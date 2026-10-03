import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { URL, fileURLToPath } from 'node:url';
import process from 'node:process';

test('project Pages contains only redirects and preserves deep links, queries and anchors', async () => {
  const output = await mkdtemp(join(tmpdir(), 'aimd-pages-redirect-'));
  try {
    await writeFile(join(output, 'stale.html'), 'Old content must not remain published');
    execFileSync(process.execPath, [fileURLToPath(new URL('./build-pages-redirect.mjs', import.meta.url)), output]);
    assert.deepEqual((await readdir(output)).sort(), ['.nojekyll', '404.html', 'index.html']);
    const html = await readFile(join(output, 'index.html'), 'utf8');
    assert.equal(await readFile(join(output, '404.html'), 'utf8'), html);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    for (const [suffix, expected] of [
      ['', '/'],
      ['/', '/'],
      ['/docs/guides/rich-components/#image-preview', '/docs/guides/rich-components/#image-preview'],
      [
        '/storybook/react/?path=/story/customization-rich-components--image-gallery',
        '/storybook/react/?path=/story/customization-rich-components--image-gallery',
      ],
      [
        '/storybook/vue/iframe.html?id=customization-rich-components--image-gallery&viewMode=story',
        '/storybook/vue/iframe.html?id=customization-rich-components--image-gallery&viewMode=story',
      ],
      ['//example.org', '//example.org'],
    ]) {
      const location = new URL('https://ai-markdown.github.io/ai-markdown' + suffix);
      let redirect;
      location.replace = (url) => {
        redirect = url;
      };
      runInNewContext(script, { URL, location });
      assert.equal(redirect, 'https://ai-markdown.github.io' + expected);
      assert.equal(new URL(redirect).origin, 'https://ai-markdown.github.io');
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
