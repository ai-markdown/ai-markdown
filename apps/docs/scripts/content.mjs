import { env } from 'node:process';
import { readingNavigation } from './navigation.mjs';
import { normalizeBase } from './links.mjs';
import { locales } from '../src/i18n/config.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const generated = resolve(root, 'apps/docs/src/content/docs');
export const repo = 'https://github.com/ai-markdown/ai-markdown';

function markdownFiles(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    // Internal planning and review records are intentionally not published.
    if (entry.isDirectory()) return entry.name === 'api' ? markdownFiles(path) : [];
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

export function pages() {
  const english = [
    { source: 'apps/docs/content/index.md', slug: 'docs' },
    { source: 'apps/docs/content/examples.md', slug: 'docs/examples' },
    ...markdownFiles('apps/docs/content/guides').map((source) => ({
      source,
      slug:
        source === 'apps/docs/content/guides/index.md'
          ? 'docs/guides'
          : source.replace(/^apps\/docs\/content\/guides\//, 'docs/guides/').replace(/\.md$/, ''),
    })),
    ...['react', 'vue', 'react-mantine'].map((name) => ({
      source: `apps/docs/content/reference/${name}.md`,
      // Preserve links to the former canonical source, including fragments.
      aliases: [`packages/${name}/README.md`],
      slug: `docs/${name === 'react-mantine' ? 'react/mantine' : name}`,
    })),
    ...['core', 'engine', 'remark-mark-highlight', 'code-language-detector'].map((name) => ({
      source: `packages/${name}/README.md`,
      slug: `docs/${{ 'remark-mark-highlight': 'plugins/highlight', 'code-language-detector': 'plugins/code-language-detector' }[name] ?? name}`,
    })),
  ];
  const translated = Object.keys(locales)
    .filter((locale) => locale !== 'root')
    .flatMap((locale) =>
      english.flatMap((page) => {
        const source = `apps/docs/content/translations/${locale}/${page.source}`;
        return existsSync(resolve(root, source))
          ? [{ ...page, source, slug: `${locale}/${page.slug}`, locale, canonicalSource: page.source }]
          : [];
      })
    );
  return [...english, ...translated];
}

export function syncContent() {
  const entries = pages();
  const expected = new Set();
  for (const { source, slug, locale } of entries) {
    const raw = readFileSync(resolve(root, source), 'utf8');
    const heading = raw.match(/^# (.+)\r?\n/);
    if (!heading) throw new Error(`Expected a leading H1 in ${source}`);
    const title = heading[1].replace(/`/g, '');
    const navigation = Object.entries(readingNavigation(slug, locale, normalizeBase(env.DOCS_BASE)))
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`)
      .join('');
    const text = `---\ntitle: ${JSON.stringify(title)}\n${navigation}slug: ${JSON.stringify(slug)}\neditUrl: ${JSON.stringify(`${repo}/edit/main/${source}`)}\n---\n${raw.slice(heading[0].length)}`;
    const target = resolve(generated, `${slug || 'index'}.md`);
    expected.add(target);
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) writeFileSync(target, text);
  }
  function prune(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) prune(path);
      else if (!expected.has(path)) rmSync(path);
    }
  }
  prune(generated);
}

export function contentIntegration() {
  return {
    name: 'ai-markdown-repository-docs',
    hooks: {
      'astro:config:setup': () => syncContent(),
      'astro:server:setup': ({ server }) => {
        const sources = [resolve(root, 'apps/docs/content'), ...pages().map(({ source }) => resolve(root, source))];
        server.watcher.add(sources);
        server.watcher.on('all', (event, path) => {
          const name = relative(root, path).replaceAll('\\', '/');
          if (
            ['add', 'change', 'unlink'].includes(event) &&
            name.endsWith('.md') &&
            (name.startsWith('apps/docs/content/') || pages().some(({ source }) => source === name))
          )
            syncContent();
        });
      },
    },
  };
}
