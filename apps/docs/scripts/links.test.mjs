import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteUrl, normalizeBase } from './links.mjs';

const entries = [
  { source: 'apps/docs/content/guides/guide.md', slug: 'docs/guides/guide' },
  { source: 'packages/vue/README.md', slug: 'docs/vue' },
];
test('public documentation artifacts are served locally under the deployment base in either locale', () => {
  for (const locale of ['', 'zh-cn']) {
    assert.equal(
      rewriteUrl(
        '../../public/architecture/birdview/runtime.html',
        'apps/docs/content/guides/architecture.md',
        entries,
        '/preview/',
        '',
        locale
      ),
      '/preview/architecture/birdview/runtime.html'
    );
  }
  assert.equal(
    rewriteUrl(
      '../../public/architecture/birdview/development.json?download=1',
      'apps/docs/content/guides/architecture.md',
      entries
    ),
    '/architecture/birdview/development.json?download=1'
  );
});
test('repository links preserve anchors and deployment prefixes', () => {
  assert.equal(
    rewriteUrl('../../apps/docs/content/guides/guide.md#setup', 'packages/vue/README.md', entries, '/preview/docs/'),
    '/preview/docs/docs/guides/guide/#setup'
  );
  assert.equal(
    rewriteUrl('../../../../packages/vue/README.md', 'apps/docs/content/guides/guide.md', entries),
    '/docs/vue/'
  );
  assert.equal(
    rewriteUrl(
      'https://github.com/ai-markdown/ai-markdown/blob/main/apps/docs/content/guides/guide.md#setup',
      'apps/docs/content/guides/guide.md',
      entries
    ),
    '/docs/guides/guide/#setup'
  );
});
test('source references and external URLs keep their intended destinations', () => {
  assert.equal(
    rewriteUrl('../../../../packages/vue/src/index.ts', 'apps/docs/content/guides/guide.md', entries),
    'https://github.com/ai-markdown/ai-markdown/blob/main/packages/vue/src/index.ts'
  );
  for (const url of ['#setup', 'https://example.com/a', 'mailto:hello@example.com', '//example.com/a'])
    assert.equal(rewriteUrl(url, 'apps/docs/content/guides/guide.md', entries), url);
});
test('examples use the configured catalog or useful local instructions', () => {
  assert.equal(
    rewriteUrl('storybook:vue/', 'apps/docs/content/guides/guide.md', entries, '/preview/'),
    '/preview/docs/guides/storybook/'
  );
  assert.equal(
    rewriteUrl(
      'storybook:react/?path=/docs/example--docs',
      'apps/docs/content/guides/guide.md',
      entries,
      '/',
      'https://example.com/catalog/'
    ),
    'https://example.com/catalog/react/?path=/docs/example--docs'
  );
});
test('base must be a pathname', () => {
  assert.equal(normalizeBase('/preview/docs'), '/preview/docs/');
  assert.equal(normalizeBase('/'), '/');
  assert.throws(() => normalizeBase('https://example.com/'));
});

test('query strings and anchors both survive rewriting', () => {
  assert.equal(
    rewriteUrl('./guide.md?mode=full#setup', 'apps/docs/content/guides/guide.md', entries),
    '/docs/guides/guide/?mode=full#setup'
  );
});

test('Markdown, reference and raw HTML links rewrite without altering code examples', async () => {
  const { createMarkdownProcessor } = await import('@astrojs/markdown-remark');
  const { default: rehypeRaw } = await import('rehype-raw');
  const { repositoryLinks } = await import('./links.mjs');
  const { generated } = await import('./content.mjs');
  const { pathToFileURL } = await import('node:url');
  const renderer = await createMarkdownProcessor({
    syntaxHighlight: false,
    rehypePlugins: [rehypeRaw, [repositoryLinks, { base: '/preview/' }]],
  });
  const source =
    '[Vue](../../../../packages/vue/README.md)\n\n[Vue ref][v]\n\n[v]: ../../../../packages/vue/README.md\n\n<a href="../../../../packages/vue/README.md">Vue HTML</a>\n\n```md\n[Vue](../../../../packages/vue/README.md)\n```';
  const { code } = await renderer.render(source, {
    fileURL: pathToFileURL(`${generated}/docs/guides/getting-started.md`),
  });
  assert.equal((code.match(/href="\/preview\/docs\/vue\/"/g) || []).length, 3);
  assert.match(code, /\[Vue\]\((?:\.\.\/){4}packages\/vue\/README\.md\)/);
});

test('embedded examples keep the deployment base', () => {
  assert.equal(
    rewriteUrl('examples:', 'apps/docs/content/guides/guide.md', entries, '/preview/'),
    '/preview/examples/'
  );
  assert.equal(rewriteUrl('examples:', 'apps/docs/content/guides/guide.md', entries, '/'), '/examples/');
});

test('published README guide links follow the current deployment base', () => {
  assert.equal(
    rewriteUrl(
      'https://ai-markdown.github.io/docs/guides/guide/#setup',
      'packages/vue/README.md',
      entries,
      '/preview/'
    ),
    '/preview/docs/guides/guide/#setup'
  );
});

test('README website and examples links follow the current deployment base', () => {
  assert.equal(
    rewriteUrl('https://ai-markdown.github.io/', 'packages/vue/README.md', entries, '/preview/'),
    '/preview/'
  );
  assert.equal(
    rewriteUrl('https://ai-markdown.github.io/examples/', 'packages/vue/README.md', entries, '/preview/'),
    '/preview/examples/'
  );
});

test('moved references keep legacy README source links and fragments', () => {
  const moved = [
    { source: 'apps/docs/content/reference/vue.md', aliases: ['packages/vue/README.md'], slug: 'docs/vue' },
  ];
  for (const link of [
    '../../../../packages/vue/README.md#component-props',
    'https://github.com/ai-markdown/ai-markdown/blob/main/packages/vue/README.md#component-props',
    '../reference/vue.md#component-props',
  ]) {
    assert.equal(
      rewriteUrl(link, 'apps/docs/content/guides/getting-started.md', moved, '/preview/'),
      '/preview/docs/vue/#component-props'
    );
  }
});

test('Chinese links keep their locale while explicit English and Storybook links keep their target', () => {
  const entries = [
    { source: 'apps/docs/content/guides/next.md', slug: 'zh-cn/docs/guides/next', locale: 'zh-cn' },
    { source: 'apps/docs/content/guides/next.md', slug: 'docs/guides/next' },
  ];
  const source = 'apps/docs/content/guides/current.md';
  for (const base of ['/', '/ai-markdown/']) {
    assert.equal(rewriteUrl('next.md', source, entries, base, '', 'zh-cn'), `${base}zh-cn/docs/guides/next/`);
    assert.equal(rewriteUrl('examples:', source, entries, base, '', 'zh-cn'), `${base}zh-cn/examples/`);
    assert.equal(
      rewriteUrl('https://ai-markdown.github.io/docs/', source, entries, base, '', 'zh-cn'),
      `${base}zh-cn/docs/`
    );
    assert.equal(
      rewriteUrl('english:docs/guides/next/', source, entries, base, '', 'zh-cn'),
      `${base}docs/guides/next/`
    );
    assert.equal(
      rewriteUrl('storybook:vue/', source, entries, base, '', 'zh-cn'),
      `${base}zh-cn/docs/guides/storybook/`
    );
    assert.equal(
      rewriteUrl('storybook:vue/', source, entries, base, `${base}storybook/`, 'zh-cn'),
      `${base}storybook/vue/`
    );
  }
});
