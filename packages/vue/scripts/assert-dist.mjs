import assert from 'node:assert/strict';
import { readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { distGraph } from '../../../scripts/dist-graph.mjs';
copyFileSync('src/styles.css', 'dist/styles.css');
// Externals may sit in a shared chunk rather than in the entry file itself.
for (const file of ['index.js', 'index.cjs', 'index.dev.js', 'index.dev.cjs']) {
  const { text } = distGraph(file);
  for (const dependency of ['vue', '@ai-markdown/core', '@ai-markdown/engine'])
    assert(text.includes(dependency), `${file}: missing external ${dependency}`);
}
for (const file of readdirSync('dist', { recursive: true }).map(String)) {
  if (!/\.(?:js|cjs)$/.test(file)) continue;
  const source = readFileSync(`dist/${file}`, 'utf8');
  assert(!source.includes('@ai-react-markdown/'), `${file}: legacy dependency`);
  assert(!/from ['"]react['"]|require\(['"]react['"]\)|["']use client["']/.test(source), `${file}: React dependency`);
}
