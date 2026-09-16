import type { DetectionRule } from '../types';

/**
 * The tag must be on a non-comment line (the line does not start with /*, *, //, #). Comments in JS / TS / CSS /
 * Python often carry HTML usage examples (` * Usage: <script src="x.js"></script>`); without this exclusion, a JS
 * snippet would be detected as html from the tag in its comment before any code arrives.
 */
const NOT_COMMENT_LINE = '^(?![ \\t]*(?:/\\*|\\*|//|#))[^\\n]{0,200}?';

/**
 * The tag must not directly follow a quote: `toContain('<style>')` and `renderedHtml: '<h1>Hello</h1>'`
 * are HTML held in JS / TS / Python strings, not an HTML file itself.
 * In real HTML a tag is preceded by the line start, whitespace or the `>` of the previous tag, almost never a quote.
 */
const NOT_IN_QUOTE = '(?<![\'"`])';

export const markupRules: DetectionRule[] = [
  {
    id: 'html-doctype',
    pattern: /^\s*<!DOCTYPE\s+html/i,
    scores: { html: 12, xml: -4 },
    definitive: 'html',
  },
  {
    id: 'xml-declaration',
    pattern: /^\s*<\?xml\s+version\s*=/,
    scores: { xml: 12, html: -4 },
    definitive: 'xml',
  },
  {
    id: 'html-structural-tag',
    pattern: new RegExp(
      `${NOT_COMMENT_LINE}${NOT_IN_QUOTE}<(?:html|head|body|div|span|p|a|ul|li|table|form|section|nav|header|footer)\\b[^>\\n]{0,120}>`,
      'im'
    ),
    scores: { html: 7, xml: 1 },
  },
  {
    id: 'html-script-style-tag',
    pattern: new RegExp(`${NOT_COMMENT_LINE}${NOT_IN_QUOTE}<(?:script|style|link|meta)\\b[^>\\n]{0,160}>`, 'im'),
    scores: { html: 8 },
  },
  {
    id: 'html-multiline-tag',
    // <meta alone on its line with one attribute per line: the single-line tag rules cannot match this formatting
    pattern:
      /^<(?:meta|link|script|img|input|a|button|iframe|source|video|div|section)[ \t]*\n[ \t]+[\w:-]{1,40}=["']/m,
    scores: { html: 7, xml: 2 },
  },
  {
    id: 'style-tag-not-stylesheet',
    // A standalone CSS / SCSS / Less file cannot contain a <style> tag.
    // Its presence means the CSS is only a section embedded in HTML (or Vue / Svelte);
    // without this rule, a stream halfway through a <style> block lets the CSS rules outweigh the HTML evidence
    // before it. Non-comment lines only, again: a CSS comment saying "put this inside a <style> tag" must not
    // push an ordinary stylesheet down until it cannot be detected
    pattern: new RegExp(`${NOT_COMMENT_LINE}${NOT_IN_QUOTE}<style\\b[^>\\n]{0,80}>`, 'im'),
    scores: { html: 2, css: -8, scss: -6, less: -6 },
  },
  {
    id: 'html-attribute',
    pattern: /\s(?:class|id|href|src|alt|type)\s*=\s*["'][^"'\n]{0,120}["']/,
    scores: { html: 4, xml: 2 },
  },
  {
    id: 'markup-generic-tag',
    // A plain custom tag only says "this is markup"; it is not enough to separate HTML / XML
    pattern: new RegExp(
      `${NOT_COMMENT_LINE}${NOT_IN_QUOTE}<([A-Za-z][\\w:-]{0,40})\\b[^>\\n]{0,120}>[\\s\\S]{0,200}<\\/\\1>`,
      'm'
    ),
    scores: { html: 3, xml: 3 },
  },
  {
    id: 'xml-namespace-attr',
    pattern: /\sxmlns(?::\w+)?\s*=\s*["']/,
    scores: { xml: 9, html: -2 },
  },
  {
    id: 'xml-self-closing-custom',
    pattern: /<[A-Za-z][\w:-]{0,40}(?:\s[^>\n]{0,120})?\/>/,
    scores: { xml: 3, html: 1, jsx: 2, tsx: 2 },
  },
];
