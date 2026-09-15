/**
 * Render-time URL sanitization policy exposed to cross-chunk placeholders.
 *
 * Carries the resolved `urlTransform` and `sanitizeSchema` for the current
 * `<AIMarkdown>` instance so {@link CrossChunkLink} and
 * {@link CrossChunkImage} can apply the same two-gate pipeline that
 * react-markdown's standalone hast pass applies to in-tree `<a href>` and
 * `<img src>` elements. See `crossChunkUrlSanitize.ts` for the gate logic
 * and why it must happen at render time rather than at contribute time.
 *
 * Value is `null` outside a coordinated render. When `null`, the
 * placeholders fall back to a safe baseline (`defaultUrlTransform` only),
 * which preserves the v1.4.3 behavior on the rare path where the context
 * is missing (e.g., a test renders a placeholder without an `<AIMarkdown>`
 * ancestor).
 *
 * @module components/crossChunkUrlContext
 */
import { createContext } from 'react';
import type { Components, UrlTransform } from './markdown';
import type { SanitizeSchema } from '@ai-markdown/engine';

export interface CrossChunkUrlPolicy {
  /** Resolved urlTransform — caller's prop or {@link defaultUrlTransform}. */
  urlTransform: UrlTransform;
  /** Resolved sanitize schema — caller's prop or the library default. */
  sanitizeSchema: SanitizeSchema;
  /** Element overrides for materialized footnote marks. */
  components?: Components;
}

export const CrossChunkUrlContext = createContext<CrossChunkUrlPolicy | null>(null);
