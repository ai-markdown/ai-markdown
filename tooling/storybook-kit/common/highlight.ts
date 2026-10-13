import hljs from 'highlight.js/lib/common';

/**
 * Markup from highlight.js for the `highlight` option of the code block
 * factories, or nothing for a language it does not know. The stories wrap the
 * markup in a `<span>`; it comes from the highlighter, never from the Markdown
 * source. Token colors are in `highlight.css`.
 */
export function highlightHtml(code: string, language: string): string | undefined {
  if (!hljs.getLanguage(language)) return;
  return hljs.highlight(code, { language }).value;
}
