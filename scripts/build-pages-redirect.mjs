/* global process */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// The project Pages site is only a compatibility redirect. All content is
// published by ai-markdown.github.io through the reusable Pages workflow.
const output = resolve(process.argv[2] ?? '_site');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Markdown</title>
<link rel="canonical" href="https://ai-markdown.github.io/">
<script>
const target = new URL('https://ai-markdown.github.io/');
target.pathname = location.pathname.replace(/^\\/ai-markdown(?=\\/|$)/, '') || '/';
target.search = location.search;
target.hash = location.hash;
location.replace(target.href);
</script>
</head><body><p>AI Markdown has one home: <a href="https://ai-markdown.github.io/">ai-markdown.github.io</a>.</p></body></html>
`;
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(['index.html', '404.html'].map((name) => writeFile(resolve(output, name), html)));
await writeFile(resolve(output, '.nojekyll'), '');
