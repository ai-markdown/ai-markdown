import type { Element, RootContent } from 'hast';

export interface CodeSource {
  code: string;
  language: string;
}
/** Enhance only ordinary fenced code; preserve all other pre overrides. */
export function extractCode(node?: Element): CodeSource | null {
  if (node?.tagName !== 'pre' || node.children.length !== 1 || Object.keys(node.properties).length) return null;
  const child = node.children[0];
  if (
    child.type !== 'element' ||
    child.tagName !== 'code' ||
    child.children.some((n) => n.type !== 'text') ||
    Object.keys(child.properties).some((k) => k !== 'className')
  )
    return null;
  const classes = child.properties.className ?? [];
  const names = (Array.isArray(classes) ? classes : String(classes).split(/\s+/)).map(String).filter(Boolean);
  if (names.some((n) => !n.startsWith('language-'))) return null;
  const languages = [...new Set(names.map((n) => n.slice(9).trim().toLowerCase()))];
  if (languages.length > 1) return null;
  return { code: child.children.map((n) => (n.type === 'text' ? n.value : '')).join(''), language: languages[0] ?? '' };
}
export function normalizeRenderers<T>(renderers: Readonly<Record<string, T>>): Readonly<Record<string, T>> {
  const result: Record<string, T> = Object.create(null);
  for (const [language, renderer] of Object.entries(renderers)) {
    const key = language.trim().toLowerCase();
    if (!key) throw new Error('Code renderer language must not be empty');
    if (Object.hasOwn(result, key)) throw new Error(`Duplicate code renderer: ${key}`);
    result[key] = renderer;
  }
  return Object.freeze(result);
}
function annotation(node: RootContent): Element | undefined {
  if (node.type !== 'element') return;
  if (node.tagName === 'annotation' && node.properties.encoding === 'application/x-tex') return node;
  for (const child of node.children) {
    const found = annotation(child);
    if (found) return found;
  }
}
function text(node: RootContent): string {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return '';
  if (node.tagName === 'table') throw new Error('Nested tables cannot be exported');
  if (Array.isArray(node.properties.className) && node.properties.className.includes('katex')) {
    const tex = annotation(node);
    if (!tex) throw new Error('Math is missing its text annotation');
    return tex.children.map(text).join('');
  }
  if (node.tagName === 'br') return '\n';
  if (node.tagName === 'img' || node.tagName === 'cross-chunk-image') return String(node.properties.alt ?? '');
  return node.children.map(text).join('');
}
export type TableProjection = { rows: string[][]; reason?: undefined } | { rows?: undefined; reason: string };
/** Project sanitized HAST semantics, never custom cell UI or raw Markdown. */
export function projectTable(node?: Element): TableProjection {
  try {
    if (node?.tagName !== 'table') throw new Error('Table source is unavailable');
    const rows: string[][] = [];
    const walk = (parent: Element) => {
      for (const child of parent.children) {
        if (child.type === 'text' && !child.value.trim()) continue;
        if (child.type !== 'element') throw new Error('Unsupported table content');
        if (child.tagName === 'tr') {
          const cells: string[] = [];
          for (const cell of child.children) {
            if (cell.type === 'text' && !cell.value.trim()) continue;
            if (
              cell.type !== 'element' ||
              !['th', 'td'].includes(cell.tagName) ||
              Number(cell.properties.colSpan ?? 1) !== 1 ||
              Number(cell.properties.rowSpan ?? 1) !== 1
            )
              throw new Error('Only tables without merged cells can be exported');
            cells.push(text(cell));
          }
          rows.push(cells);
        } else if (['thead', 'tbody', 'tfoot'].includes(child.tagName) && parent === node) walk(child);
        else throw new Error('Unsupported table structure');
      }
    };
    walk(node);
    if (!rows.length || !rows[0].length || rows.some((r) => r.length !== rows[0].length))
      throw new Error('Only rectangular tables can be exported');
    return { rows };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : 'Table cannot be exported' };
  }
}
/** Spreadsheet text policy is independent of delimiter quoting. Negative
 * numbers stay numeric; formulas/control-prefixed text stay literal. */
// Control-prefixed formulas must stay literal when pasted into a spreadsheet.
// eslint-disable-next-line no-control-regex
const formulaPrefix = /^[\s\u0000-\u001f]*[=+@-]/;
export function serializeTable(rows: readonly (readonly string[])[], delimiter: ',' | '\t' = ','): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          if (
            (formulaPrefix.test(value) && !/^\s*-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(value)) ||
            /^[\t\r\n]/.test(value)
          )
            value = `'${value}`;
          return /["\r\n\t,]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
        })
        .join(delimiter)
    )
    .join('\r\n');
}
