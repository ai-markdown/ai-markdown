/**
 * Two-gate URL sanitization for cross-chunk link/image placeholders.
 *
 * In the standalone path, every `<a href>` and `<img src>` element passes
 * through TWO gates before render:
 *
 *   1. `rehype-sanitize` `protocols.<attr>` allowlist — drops the attribute
 *      entirely if the URL's protocol isn't permitted for that attribute.
 *      Runs in the rehype plugin chain.
 *   2. `urlTransform(url, key, node)` — the caller's allowlist (default:
 *      `defaultUrlTransform`, which mirrors GitHub's protocol allowlist).
 *      Runs in `markdown/transform.ts` during the hast visit pass; its
 *      return value IS the attribute (`''` renders `href=""`).
 *
 * Cross-chunk references skip BOTH passes naturally: the placeholder hast
 * tag (`<cross-chunk-link>` / `<cross-chunk-image>`) carries only a `label`
 * attribute; the real URL is looked up from the registry at React render
 * time, AFTER both passes have run. Without an explicit re-sanitization
 * here, cross-chunk renders would observably diverge from standalone:
 *
 *   - A `[evil]: javascript:…` def in chunk A used by chunk B would render
 *     a live `javascript:` link, even though the same source in standalone
 *     mode is stripped.
 *   - A consumer who allows a custom scheme via `urlTransform` but did NOT
 *     add it to `sanitizeSchema.protocols` would see standalone strip the
 *     `href`, but cross-chunk render it — silently breaking the "two gates,
 *     defense in depth" contract documented in README.
 *   - A key-aware `urlTransform` (e.g. one that allows a scheme only on
 *     `href` but not `src`) would behave correctly in standalone but be
 *     bypassed in the cross-chunk image path if we sanitized once at
 *     contribute time with a fixed key.
 *
 * This helper makes the cross-chunk path observably identical to the
 * standalone two-gate pipeline, parameterised by the correct `key` for
 * each tag (`'href'` for `<a>`, `'src'` for `<img>`).
 *
 * @module components/crossChunkUrlSanitize
 */

import { normalizeUri } from 'micromark-util-sanitize-uri';
import type { Element as HastElement } from 'hast';
import type { UrlTransform } from './markdown';
import type { SanitizeSchema } from './extendSanitizeSchema';
import { sanitizeSchema as libraryDefaultSchema } from './sanitizeSchema';

export type UrlAttrKey = 'href' | 'src';
export type UrlAttrTag = 'a' | 'img';

/** Synthetic hast element passed as the `node` argument to `urlTransform`.
 *  Mirrors the shape the in-tree pipeline would have produced. */
function fakeElement(tagName: UrlAttrTag, key: UrlAttrKey, url: string): HastElement {
  return { type: 'element', tagName, properties: { [key]: url }, children: [] };
}

/** True if the URL is relative (no protocol prefix before `/`, `?`, or `#`).
 *  Relative URLs are always allowed — this mirrors the convention used in
 *  `defaultUrlTransform` and `hast-util-sanitize`. */
function isRelative(url: string, colon: number): boolean {
  if (colon === -1) return true;
  const slash = url.indexOf('/');
  const questionMark = url.indexOf('?');
  const numberSign = url.indexOf('#');
  if (slash !== -1 && colon > slash) return true;
  if (questionMark !== -1 && colon > questionMark) return true;
  if (numberSign !== -1 && colon > numberSign) return true;
  return false;
}

/** Check the URL's protocol against an allowlist (mirrors hast-util-sanitize's
 *  `Schema.protocols.<attr>` semantics). Relative URLs are always allowed.
 *
 *  **Case-sensitive comparison by design** — `hast-util-sanitize` does literal
 *  string equality on the protocol prefix (`url.slice(0, p.length) === p`),
 *  so `HTTPS://x` against `['http','https']` is stripped. We mirror that to
 *  preserve observable parity with the standalone in-tree pipeline; a more
 *  permissive cross-chunk comparison would let mixed-case URLs slip through
 *  here that the standalone path strips. */
function isProtocolAllowed(url: string, allowed: ReadonlyArray<string>): boolean {
  const colon = url.indexOf(':');
  if (isRelative(url, colon)) return true;
  const protocol = url.slice(0, colon);
  return allowed.some((p) => p === protocol);
}

/**
 * Run a cross-chunk-resolved URL through both standalone gates, in the
 * standalone ORDER: `rehype-sanitize`'s protocol allowlist runs in the
 * plugin chain first (a blocked URL loses the attribute entirely), then
 * `urlTransform` rewrites whatever survived during the hast visit pass (its
 * return value is the attribute — `''` from `defaultUrlTransform` renders
 * `href=""`, exactly like a legal empty destination `[x]: <>`).
 *
 * @returns `null` when the protocol gate strips the attribute (render it
 *   ABSENT); otherwise the transformed URL string — possibly `''`, which
 *   the caller must render as `href=""` / `src=""` to stay byte-identical
 *   with standalone (v2.4.1 review: the two used to collapse into `''` and
 *   the placeholder omitted the attribute for `[x]: <>` too).
 *
 * @deprecated The adapters resolve cross-chunk references with
 *   `resolveCrossChunkReference` (`./resolveCrossChunkReference`), which
 *   sanitizes the final element (attribute and ancestor rules, `title`,
 *   `alt`) and rebases `#hash` hrefs with the clobber prefix before the URL
 *   transform. This helper only runs the protocol gate and the URL
 *   transform on a bare URL: it never rebases a hash and knows nothing about
 *   the element's other attributes, so its output can differ from what the
 *   adapters render. It stays exported through 3.x; on a plain URL (no
 *   hash) both helpers reach the same allow/block decision, and
 *   `crossChunkUrlSanitize.test.ts` pins that.
 */
export function sanitizeCrossChunkUrl(
  rawUrl: string,
  key: UrlAttrKey,
  tagName: UrlAttrTag,
  urlTransform: UrlTransform,
  schema: SanitizeSchema
): string | null {
  // Gate 0: the same `normalizeUri` mdast-util-to-hast applies to every
  // in-tree `href`/`src` before the gates see it (percent-encodes spaces,
  // non-ASCII, `"`, `<` …). Without it a cross-chunk `<https://x/a b>`
  // rendered `href="https://x/a b"` where standalone renders `a%20b`
  // (v2.4.0 review).
  rawUrl = normalizeUri(rawUrl);

  // Gate 1: rehype-sanitize protocol allowlist. Mirrors hast-util-sanitize's
  // exact merge + lookup semantics (see `lib/index.js:235` + `:672`):
  //
  //   1. Upstream merges via `{...defaultSchema, ...options}` — a SHALLOW
  //      spread. If the caller schema has no `protocols` key at all, the
  //      resulting state inherits `defaultSchema.protocols` entirely.
  //      Mirror this by falling back to the library default's protocols
  //      when the caller didn't specify any.
  //   2. If the caller DID specify `protocols`, upstream uses caller's
  //      object verbatim — keys the caller didn't list become "no
  //      restriction" (upstream's `if (!protocols || ... === 0) return true`).
  //      Do NOT cherry-pick library defaults for missing keys here, or the
  //      helper becomes stricter than standalone in the partial-schema
  //      case (the round-2 codex finding's mirror image).
  //   3. An empty array on the caller's `protocols.<key>` means "no
  //      restriction" per upstream (the `length === 0` branch), not "reject
  //      all" — preserve that.
  //
  // Net effect: every shape the standalone path tolerates produces the
  // same observable result here, including a TypeScript-bypass sparse
  // schema (caller passes no `protocols` → library default protocols apply
  // for both gates).
  // `Object.hasOwn`, not `=== undefined`: upstream's shallow spread keeps an
  // EXPLICIT `protocols: undefined` (own key, undefined value) and then
  // treats it as "no restriction" — only an ABSENT key inherits the
  // default's protocols (v2.4.2 review P3-4).
  const allowed = Object.hasOwn(schema, 'protocols') ? schema.protocols?.[key] : libraryDefaultSchema.protocols?.[key];
  if (allowed && allowed.length > 0 && !isProtocolAllowed(rawUrl, allowed)) return null;

  // Gate 2: urlTransform — caller's allowlist, called with the correct key
  // and a synthetic node mirroring what the in-tree pass would have seen.
  const transformed = urlTransform(rawUrl, key, fakeElement(tagName, key, rawUrl));
  if (transformed == null) return null;
  return String(transformed);
}
