import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const RELATIVE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

/**
 * Source text of a dist entry together with every chunk it loads through a
 * relative specifier. The bundler may move a module, and with it an external
 * import, out of the entry file into a shared chunk; a check for "this entry
 * reaches package X" has to read the whole graph, not the entry file alone.
 *
 * @param {string} entry path relative to `dist`, e.g. `index.cjs`
 * @returns {{ files: string[], text: string }}
 */
export function distGraph(entry, dist = 'dist') {
  const seen = new Map();
  const visit = (file) => {
    if (seen.has(file)) return;
    const text = readFileSync(join(dist, file), 'utf8');
    seen.set(file, text);
    for (const [, specifier] of text.matchAll(RELATIVE)) {
      if (/\.(?:js|cjs)$/.test(specifier)) visit(normalize(join(dirname(file), specifier)));
    }
  };
  visit(normalize(entry));
  return { files: [...seen.keys()], text: [...seen.values()].join('\n') };
}
