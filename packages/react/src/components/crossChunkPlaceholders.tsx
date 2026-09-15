/**
 * Placeholder React components that custom hast tags
 * (`<cross-chunk-link>` / `<cross-chunk-image>` / `<footnote-sup>`)
 * map to via react-markdown's `components` prop.
 *
 * Each subscribes to its document's Registry via useSyncExternalStore.
 * On selector miss (registry not present, label not resolved, or a
 * hydration render — see isHydratingServerHtml):
 *   - FootnoteSupNumber renders the chunk-local mark, or null for a phantom
 *   - CrossChunkLink falls back to the chunk's own def, else literal source text by referenceType
 *   - CrossChunkImage falls back to the chunk's own def, else literal source text by referenceType
 *
 * @module components/crossChunkPlaceholders
 */
import {
  type ReactNode,
  Fragment,
  cloneElement,
  isValidElement,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react';
import { useAIMarkdownDocument } from '../context';
import { useDocumentRegistry } from './AIMarkdownDocuments';
import { ChunkSymbolContext } from './chunkSymbolContext';
import { CrossChunkUrlContext } from './crossChunkUrlContext';
import { resolveCrossChunkReference } from '@ai-markdown/engine';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { jsx, jsxs } from 'react/jsx-runtime';
import type { CrossChunkUrlPolicy } from './crossChunkUrlContext';
import { defaultUrlTransform, renderHastSubtree } from './markdown';
import { sanitizeSchema as defaultSanitizeSchema } from '@ai-markdown/engine';
import type { Element } from 'hast';
import type { LinkDef } from '@ai-markdown/engine';
import { footnoteSafeId } from '@ai-markdown/engine';

type RefType = 'full' | 'collapsed' | 'shortcut' | undefined;

/** Server snapshot of the per-label stores below. Every client `getSnapshot`
 *  returns a JSON string, never the empty string, so a placeholder that
 *  receives this value is rendering on the server or hydrating server HTML
 *  (React hands out the server snapshot for the whole hydration render).
 *  Hoisted to module level so the getter's identity is stable across
 *  renders. */
const SERVER_LABEL_SNAPSHOT = '';
const getServerLabelSnapshot = () => SERVER_LABEL_SNAPSHOT;

/**
 * Whether this render is hydrating server HTML, given that a
 * useSyncExternalStore call handed back its server snapshot. React uses the
 * server snapshot in exactly two places: the server render, and the
 * hydration render on the client. In a browser environment it therefore
 * means hydration.
 *
 * The distinction matters for the registry. On the server, effects never
 * run, so the registry a render reads is empty and the output is the
 * chunk's standalone output. On the client, each chunk sits in its own
 * Suspense boundary when the consumer wraps it in one, and a boundary can
 * hydrate after its siblings have committed and their effects have
 * registered labels and contributed definitions. A hydration render that
 * read the live registry would then emit phantom placeholders and resolve
 * `[^a]` / `[link][x]` where the server emitted literal text, and React
 * would throw the boundary away with a recoverable hydration error. So a
 * hydrating render treats the registry as absent, matching the server
 * byte for byte; once hydration completes React sees that the live
 * snapshot differs from the server one and re-renders, at which point the
 * registry wins as it always did. `MarkdownContent` applies the same rule
 * to its registry-version store, and the placeholders below to their
 * per-label stores, so the phantom targets and the resolved marks agree.
 */
export function isHydratingServerHtml(observedServerSnapshot: boolean): boolean {
  return observedServerSnapshot && typeof window !== 'undefined';
}

/** The registry a placeholder may read in this render: null while hydrating. */
function readableRegistry<R>(registry: R | null, snapshot: string): R | null {
  return isHydratingServerHtml(snapshot === SERVER_LABEL_SNAPSHOT) ? null : registry;
}

interface FootnoteSupProps {
  label: string;
  /** Chunk-local occurrence index (1-based) of THIS particular `[^x]`
   *  reference within the chunk's parse. Used together with the per-chunk
   *  Symbol from `ChunkSymbolContext` to compute the cross-chunk *global*
   *  occurrence index, which disambiguates duplicate `id="fnref-X"` when
   *  the same footnote is referenced multiple times. Carried on the hast
   *  tag by `customMdastHandlers.footnoteReference`.
   *
   *  **Type note**: customMdastHandlers emits this as a JS number, but
   *  rehype-raw's parse5 round-trip stringifies it (verified in
   *  `customMdastHandlers.test.ts`). The component accepts either form
   *  and coerces internally so the contract is robust to the pipeline. */
  localOccurrence?: number | string;
  /** The number a standalone render would give this reference (its
   *  footnoteOrder position) — the fallback while the registry has no
   *  global number yet: server render and the client's first frame, where
   *  the chunk's LOCAL synthetic footer is what renders, so mark and footer
   *  agree. Absent on phantom (cross-chunk) refs. */
  localNumber?: number | string;
  /** Optional — but normally the hast tag carries it. */
  documentId?: string;
}

/** Coerce the on-the-wire `localOccurrence` (which may be a JS number from
 *  the handler OR a stringified attr from rehype-raw's parse5 round-trip)
 *  to a finite positive integer, or null if absent / malformed. */
function coerceLocalOccurrence(v: number | string | undefined): number | null {
  if (v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 1 ? Math.trunc(v) : null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

export function FootnoteSupNumber({
  label,
  localOccurrence: localOccurrenceRaw,
  localNumber: localNumberRaw,
}: FootnoteSupProps): ReactNode {
  const policy = useContext(CrossChunkUrlContext);
  const localOccurrence = coerceLocalOccurrence(localOccurrenceRaw);
  const localNumber = coerceLocalOccurrence(localNumberRaw);
  const { documentId, documentIdExplicit, clobberPrefix } = useAIMarkdownDocument();
  // Thread `documentIdExplicit` exactly like `MarkdownContent` does: a chunk
  // with an auto-generated id must NOT open a registry even if a raw/crafted
  // placeholder tag for it survives into hast inside <AIMarkdownDocuments>.
  // Without this, such a tag would create an orphan registry shell that has
  // no paired registerChunk, so eviction never fires — a leak on the path
  // this whole change exists to keep standalone.
  const registry = useDocumentRegistry(documentId, documentIdExplicit);
  const chunkSym = useContext(ChunkSymbolContext);
  // Route notifications by label, then select only facts used by this mark.
  const subscribe = useCallback(
    (cb: () => void) => (registry ? registry.subscribeLabel('footnote', label, cb) : () => {}),
    [registry, label]
  );
  const getSnapshot = useCallback(
    () =>
      JSON.stringify([
        registry?.globalNumber(label) ?? null,
        registry && chunkSym && localOccurrence !== null
          ? registry.globalOccurrenceForRef(chunkSym, label, localOccurrence)
          : null,
      ]),
    [registry, label, chunkSym, localOccurrence]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerLabelSnapshot);
  const readable = readableRegistry(registry, snapshot);
  const num = readable?.globalNumber(label) ?? null;
  // Same id encoding as mdast-util-to-hast's marks and footer (and the
  // aggregate footer): a raw label in the id broke `[^注]` / `[^a%b]`
  // anchors — mark and <li> disagreed (v2.4.0 review).
  const safeId = footnoteSafeId(label);
  // Global occurrence of THIS mark (`-N` for the 2nd+ ref of the label
  // across the document). Null while this chunk has not contributed yet.
  const globalOcc =
    readable && chunkSym && localOccurrence !== null && num !== null
      ? readable.globalOccurrenceForRef(chunkSym, label, localOccurrence)
      : null;
  // (`chunkSym === null` with a numbered label falls through to the id-less
  //  mark below — see the note there.)
  if (num === null) {
    // No global number yet — server render, hydration, or the client's
    // first frame before the contribute effect. Render the STANDALONE mark (local
    // number, `-N` by local occurrence) so it lines up with the local
    // synthetic footer that renders in exactly this state; the global
    // numbering takes over once the registry knows the label. Rendering
    // null here left coordinated SSR with footers but no marks
    // (2026-08 project review, core-render-02). Phantom refs (no local
    // number) still render nothing — their def is in another chunk.
    if (localNumber === null) return null;
    const localSuffix = localOccurrence !== null && localOccurrence > 1 ? `-${localOccurrence}` : '';
    // Byte-for-byte the mark mdast-util-to-hast emits (attribute set and
    // order included, id encoding via footnoteSafeId), so a wrapped chunk's
    // server output equals its standalone output — pinned in
    // byteEquivalence.test.tsx.
    return renderFootnoteMark(
      localNumber,
      {
        href: `#${clobberPrefix}fn-${safeId}`,
        id: `${clobberPrefix}fnref-${safeId}${localSuffix}`,
        dataFootnoteRef: '',
        ariaDescribedBy: [`${clobberPrefix}footnote-label`],
      },
      policy
    );
  }
  // No chunk symbol yet (`chunkSym` is state, null on a chunk's very first
  // frame) while the label is already numbered by another chunk: same
  // "known number, unregistered occurrence" transient as below — show the
  // number, no id (r2 P3 carry-over of the 2.4.5 fix; it used to render
  // nothing, and SSR shipped a footer backref pointing at no anchor).
  // Append `-N` when this is the 2nd+ occurrence of the same label across
  // the document. The first occurrence keeps the bare `fnref-${id}` so a
  // ref-once-only doc renders byte-identical to the pre-multi-ref design.
  //
  // `globalOcc === null` with `num` known: the label is numbered but THIS
  // occurrence is not in the registry — transiently (a later-mounted chunk
  // repeating the label, contribute effect pending) or permanently (a ref
  // inside a footnote DEFINITION body: the engine's per-chunk counter bumps
  // it, but contributions skip definition bodies). Both used to render
  // nothing (2026-08-19 review P3, oracle F2). The number is right either
  // way — show it, WITHOUT an id: the registry does not know this ref, so
  // no footer backref will ever point at it, and a chunk-local id would
  // collide with another chunk's real `fnref-<label>` mark (oracle re-check).
  const occSuffix = globalOcc !== null && globalOcc > 1 ? `-${globalOcc}` : '';
  const markId =
    globalOcc !== null || localOccurrence === null ? `${clobberPrefix}fnref-${safeId}${occSuffix}` : undefined;
  return renderFootnoteMark(num, { href: `#${clobberPrefix}fn-${safeId}`, id: markId, dataFootnoteRef: '' }, policy);
}

/** These generated fragments already contain the document prefix. Materialize
 * the mark before the final URL/JSX pass, just like a standalone footnote, so
 * URL callbacks and both sup/a overrides receive the actual rendered elements. */
function renderFootnoteMark(number: number, properties: Element['properties'], policy: CrossChunkUrlPolicy | null) {
  return renderHastSubtree(
    {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'sup',
          properties: {},
          children: [
            { type: 'element', tagName: 'a', properties, children: [{ type: 'text', value: String(number) }] },
          ],
        },
      ],
    },
    { urlTransform: policy?.urlTransform ?? defaultUrlTransform, components: policy?.components },
    { ownsTree: true }
  );
}

/** Convert sanitized HAST properties with the same JSX runtime as regular
 * elements (including required/class/style attributes from custom schemas).
 * Link children are already rendered; retain their component identities.
 *
 * The runtime options mirror `renderHastSubtree` (components, passNode,
 * passKeys, ignoreInvalidStyle) so a `customComponents` override for `a` /
 * `img` applies to a cross-chunk result exactly as it does to a same-chunk
 * element. `renderHastSubtree` itself is not used here because it would run
 * `urlTransform` a second time; the engine already applied it. */
function renderResolvedReference(
  input: Parameters<typeof resolveCrossChunkReference>[0],
  policy: CrossChunkUrlPolicy | null,
  clobberPrefix: string,
  children?: ReactNode
): ReactNode {
  const result = resolveCrossChunkReference(
    input,
    policy?.sanitizeSchema ?? defaultSanitizeSchema,
    policy?.urlTransform ?? defaultUrlTransform,
    clobberPrefix
  );
  if (!result.element) return result.keepChildren ? children : null;
  const rendered = toJsxRuntime(result.element, {
    Fragment,
    components: policy?.components,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
  });
  // `cloneElement` swaps `props.children` whatever the element type is, so a
  // custom `a` component receives the already-rendered link children the
  // same way the host `<a>` does.
  return input.tagName === 'a' && isValidElement(rendered) ? cloneElement(rendered, undefined, children) : rendered;
}

interface CrossChunkLinkProps {
  node?: Element;
  label: string;
  identifier?: string;
  referenceType: RefType;
  children?: ReactNode;
  /** The chunk's OWN definition (never a phantom's) — carried by the
   *  handler so the link renders before the registry has it (server render,
   *  first client frame). Runs through the same URL gates as a registry
   *  value; a cross-chunk (canonical) def replaces it once the registry
   *  resolves. See core-render-02. */
  localUrl?: string;
  localTitle?: string;
}

/** The registry's canonical def, or the chunk's own as a fallback. */
function resolveDef(
  registry: { resolveLinkDef(label: string): LinkDef | null } | null,
  label: string,
  localUrl?: string,
  localTitle?: string
): LinkDef | null {
  const canonical = registry?.resolveLinkDef(label) ?? null;
  if (canonical) return canonical;
  if (typeof localUrl === 'string') return { identifier: label, url: localUrl, title: localTitle };
  return null;
}

/** Recursively flatten a ReactNode tree to plain text. The fallback for
 *  an unresolved CrossChunkLink renders the literal markdown source
 *  (`[text][label]`); the `[text]` slot must therefore be a string, not a
 *  React element tree. Rich children — e.g. `[**bold**][missing]` whose
 *  `[text]` slot mdast lowered to `<strong>bold</strong>` then react-
 *  markdown handed us as `<strong>bold</strong>` React element — would
 *  otherwise stringify as the literal `"[object Object]"` via the previous
 *  `children?.toString?.()` path. Walking the tree and concatenating text
 *  nodes degrades the rich markup to plain text but preserves the human-
 *  readable label slot, which is what the fallback aims for. */
function reactNodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'bigint') return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToText).join('');
  if (isValidElement(node)) {
    return reactNodeToText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

function literalLink(rt: RefType, label: string, children: ReactNode): string {
  const text = reactNodeToText(children);
  switch (rt) {
    case 'full':
      return `[${text}][${label}]`;
    case 'collapsed':
      return `[${label}][]`;
    case 'shortcut':
    default:
      return `[${label}]`;
  }
}

export function CrossChunkLink({
  node,
  label,
  identifier,
  referenceType,
  children,
  localUrl,
  localTitle,
}: CrossChunkLinkProps): ReactNode {
  const { documentId, documentIdExplicit, clobberPrefix } = useAIMarkdownDocument();
  // See FootnoteSupNumber: gate on explicitness so an auto-id chunk never
  // opens a registry shell via a stray placeholder tag.
  const registry = useDocumentRegistry(documentId, documentIdExplicit);
  const policy = useContext(CrossChunkUrlContext);
  // Links and images share the definition channel; unrelated labels do not wake this subscriber.
  const subscribe = useCallback(
    (cb: () => void) => (registry ? registry.subscribeLabel('link', identifier ?? label, cb) : () => {}),
    [registry, identifier, label]
  );
  const getSnapshot = useCallback(() => {
    const def = registry?.resolveLinkDef(identifier ?? label);
    return JSON.stringify(def ? [def.url, def.title ?? null] : null);
  }, [registry, identifier, label]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerLabelSnapshot);
  const def = resolveDef(readableRegistry(registry, snapshot), identifier ?? label, localUrl, localTitle);
  if (!def) {
    return literalLink(referenceType, label, children);
  }
  return renderResolvedReference(
    { tagName: 'a', url: def.url, title: def.title, node },
    policy,
    clobberPrefix,
    children
  );
}

interface CrossChunkImageProps {
  node?: Element;
  label: string;
  identifier?: string;
  referenceType: RefType;
  alt?: string;
  /** See CrossChunkLinkProps. */
  localUrl?: string;
  localTitle?: string;
}

function literalImage(rt: RefType, label: string, alt: string): string {
  switch (rt) {
    case 'full':
      return `![${alt}][${label}]`;
    case 'collapsed':
      return `![${alt}][]`;
    case 'shortcut':
    default:
      return `![${label}]`;
  }
}

export function CrossChunkImage({
  node,
  label,
  identifier,
  referenceType,
  alt = '',
  localUrl,
  localTitle,
}: CrossChunkImageProps): ReactNode {
  const { documentId, documentIdExplicit, clobberPrefix } = useAIMarkdownDocument();
  // See FootnoteSupNumber: gate on explicitness so an auto-id chunk never
  // opens a registry shell via a stray placeholder tag.
  const registry = useDocumentRegistry(documentId, documentIdExplicit);
  const policy = useContext(CrossChunkUrlContext);
  // Same subscription-only useSyncExternalStore pattern as CrossChunkLink —
  // see that component for the rationale.
  const subscribe = useCallback(
    (cb: () => void) => (registry ? registry.subscribeLabel('link', identifier ?? label, cb) : () => {}),
    [registry, identifier, label]
  );
  const getSnapshot = useCallback(() => {
    const def = registry?.resolveLinkDef(identifier ?? label);
    return JSON.stringify(def ? [def.url, def.title ?? null] : null);
  }, [registry, identifier, label]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerLabelSnapshot);
  const def = resolveDef(readableRegistry(registry, snapshot), identifier ?? label, localUrl, localTitle);
  if (!def) {
    return literalImage(referenceType, label, alt);
  }
  return renderResolvedReference({ tagName: 'img', url: def.url, title: def.title, alt, node }, policy, clobberPrefix);
}

/**
 * Components map suitable for spreading into react-markdown's `components` prop.
 * Keys are lowercase tag names matching the custom hast tags emitted by
 * Phase 6 handlers.
 */
export const crossChunkComponents = {
  'footnote-sup': FootnoteSupNumber,
  'cross-chunk-link': CrossChunkLink,
  'cross-chunk-image': CrossChunkImage,
};
