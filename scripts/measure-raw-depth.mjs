#!/usr/bin/env node
/* global process, console, window */
// Measure the nesting depth at which the raw-HTML path overflows the call
// stack in each browser, to justify `RAW_HTML_MAX_DEPTH` in
// packages/engine/src/components/rehypeRawGuard.ts. Prints a table; asserts
// nothing.
//
// Why this is a script and not a test: the numbers compare the engine and
// the adapters against the bound that this measurement chooses, in engines
// whose stack limits are not ours to assert. They JUSTIFY a gate (the bound
// is the assertion, in rehypeRawGuard.test.ts); the harness that produced
// them lives here so it can be re-run when a renderer or a browser changes.
//
// Three probes, each bisected on N nested `<div>` (first failing N):
//   raw    the unguarded raw step alone (remark-parse -> remark-rehype ->
//          rehype-raw), i.e. hast-util-from-parse5's recursive walk
//   vue    <AIMarkdown> from @ai-markdown/vue, mounted through Vue
//   react  <AIMarkdown> from @ai-markdown/react, rendered through react-dom
// The adapter probes run the real engine chain with the depth bound lifted
// (maxDepth: Infinity) so the renderers, not the guard, are what fails;
// "engine-degraded" marks a depth where the raw step's own recursion gave
// out first and the frame rendered as plain text.
//
// Usage: node scripts/measure-raw-depth.mjs [--browser chromium|firefox|webkit]...
//        (all three by default; requires built packages and Playwright browsers)
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from 'playwright';

const browsers = process.argv.slice(2).filter((_arg, i, all) => all[i - 1] === '--browser');
const targets = browsers.length ? browsers : ['chromium', 'firefox', 'webkit'];
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const directory = await mkdtemp(join(tmpdir(), 'aimd-raw-depth-'));
const guardSource = resolve('packages/engine/src/components/rehypeRawGuard.ts');
let server;
try {
  const fixture = join(directory, 'fixture.ts');
  await writeFile(
    fixture,
    `
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeRaw from '@ai-markdown/rehype-raw';
import { createApp, h } from 'vue';
import { AIMarkdown as VueMarkdown } from '@ai-markdown/vue';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from '@ai-markdown/react';

const nested = (n: number) => '<div>'.repeat(n) + 'x';
const describe = (error: unknown) => {
  const e = error as { name?: string; message?: string };
  return String(e?.name ?? 'Error') + ': ' + String(e?.message ?? error).slice(0, 60);
};
const outcome = (host: HTMLElement, n: number) =>
  host.querySelectorAll('div').length >= n ? 'ok' : host.querySelector('p') ? 'engine-degraded' : 'incomplete';

const probes: Record<string, (n: number) => string> = {
  raw(n) {
    const processor = unified().use(remarkParse).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw, { passThrough: [] });
    try {
      processor.runSync(processor.parse(nested(n)));
      return 'ok';
    } catch (error) {
      return describe(error);
    }
  },
  vue(n) {
    const host = document.createElement('div');
    document.body.append(host);
    let failure: unknown;
    const app = createApp({ render: () => h(VueMarkdown, { content: nested(n) }) });
    app.config.errorHandler = (error) => {
      failure = error;
    };
    try {
      app.mount(host);
      if (failure) return describe(failure);
      return outcome(host, n);
    } catch (error) {
      return describe(error);
    } finally {
      try {
        app.unmount();
      } catch {
        /* a half-mounted tree may refuse to unmount */
      }
      host.remove();
    }
  },
  react(n) {
    const host = document.createElement('div');
    document.body.append(host);
    let failure: unknown;
    const root = createRoot(host, {
      onUncaughtError: (error) => {
        failure = error;
      },
    });
    try {
      flushSync(() => root.render(createElement(ReactMarkdown, { content: nested(n), incrementalParse: false })));
      if (failure) return describe(failure);
      return outcome(host, n);
    } catch (error) {
      return describe(error);
    } finally {
      try {
        flushSync(() => root.unmount());
      } catch {
        /* see above */
      }
      host.remove();
    }
  },
};
declare global {
  interface Window {
    probe: (kind: string, n: number) => string;
  }
}
window.probe = (kind, n) => probes[kind](n);
`
  );
  const bundle = join(directory, 'bundle.js');
  await build({
    entryPoints: [fixture],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    nodePaths: [
      resolve('packages/engine/node_modules'),
      resolve('packages/vue/node_modules'),
      resolve('packages/react/node_modules'),
    ],
    alias: {
      '@ai-markdown/engine': resolve('packages/engine/src/index.ts'),
      '@ai-markdown/vue': resolve('packages/vue/dist/index.js'),
      '@ai-markdown/react': resolve('packages/react/dist/index.js'),
    },
    plugins: [
      {
        name: 'lift-raw-depth-bound',
        setup(api) {
          // pluginChain.ts imports './rehypeRawGuard'; hand it a variant with
          // the bound lifted so the adapters' own recursion is what fails.
          api.onResolve({ filter: /^\.\/rehypeRawGuard$/ }, () => ({ path: 'unbounded-guard', namespace: 'lift' }));
          api.onLoad({ filter: /.*/, namespace: 'lift' }, () => ({
            contents: `import guard from ${JSON.stringify(guardSource)};
export * from ${JSON.stringify(guardSource)};
export default (options) => guard({ ...options, maxDepth: Infinity });`,
            loader: 'js',
            resolveDir: resolve('packages/engine/src/components'),
          }));
        },
      },
    ],
    define: {
      'process.env.NODE_ENV': '"production"',
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
    logLevel: 'silent',
  });
  const source = await readFile(bundle);
  server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(req.url === '/bundle.js' ? source : '<div id="app"></div><script type="module" src="/bundle.js"></script>');
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const rows = [];
  for (const name of targets) {
    const browser = await { chromium, firefox, webkit }[name].launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => typeof window.probe === 'function');
      for (const kind of ['raw', 'vue', 'react']) {
        const attempt = (n) => page.evaluate(([kind, n]) => window.probe(kind, n), [kind, n]);
        // Bisect the first failing depth; the upper end is far past any
        // engine's stack in this path.
        let low = 0,
          high = 65536,
          failure = await attempt(high);
        if (failure === 'ok') {
          rows.push({ browser: name, probe: kind, firstFailure: `> ${high}`, error: '' });
          continue;
        }
        while (high - low > 1) {
          const mid = (low + high) >> 1;
          const result = await attempt(mid);
          if (result === 'ok') low = mid;
          else {
            high = mid;
            failure = result;
          }
        }
        rows.push({ browser: name, probe: kind, firstFailure: high, error: failure });
      }
    } finally {
      await browser.close();
    }
  }
  console.table(rows);
} finally {
  if (server) await new Promise((done) => server.close(done));
  await rm(directory, { recursive: true, force: true });
}
