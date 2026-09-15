import { Fragment, h, isVNode, cloneVNode, type VNodeChild, type Slots } from 'vue';
import type { Element, Root, RootContent } from 'hast';
import { find, html, svg } from 'property-information';
import { visit } from 'unist-util-visit';
import { cloneHastForRender } from '@ai-markdown/core';
import {
  buildTransform,
  footnoteSafeId,
  isFootnoteSection,
  resolveCrossChunkReference,
  type Registry,
  type SanitizeSchema,
  type UrlTransform,
} from '@ai-markdown/engine';
import type { MarkdownComponents, MarkdownElementContext } from './types';

interface RenderOptions {
  registry: Registry | null;
  sym: symbol | null;
  clobberPrefix: string;
  sanitizeSchema: SanitizeSchema;
  urlTransform: UrlTransform;
  components: MarkdownComponents;
  slots: Slots;
  streaming: boolean;
  metadata: unknown;
}
const positive = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
};

/** DOM insertion sinks and Vue reserved keys. Never produced by Markdown,
 * kept out even when an application deliberately broadens the sanitizer. */
const SINKS = new Set(['innerHTML', 'textContent', 'outerHTML', 'ref', 'key', 'is']);

/** Whether a hast property may reach `h()`. `h()` treats a `.`-prefixed key
 * as a forced DOM property and a `^`-prefixed key as a forced attribute, so
 * `.innerHTML` would bypass a test by exact name. hast never produces a key
 * with either prefix, so any such key is rejected outright; the sink test
 * then runs on the key with the prefix stripped, so the two rules stay
 * independent of each other. Listeners are matched case-insensitively. */
function allowedProperty(key: string, attribute: string): boolean {
  if (key.startsWith('.') || key.startsWith('^')) return false;
  for (const name of [key, attribute]) {
    const bare = name.replace(/^[.^]/, '');
    if (/^on/i.test(bare) || SINKS.has(bare)) return false;
  }
  return true;
}

/** Context props a mapped component receives on top of the element's own
 * attributes. They are passed only when the component declares them. */
const CONTEXT_KEYS = ['node', 'streaming', 'metadata'] as const;
type ContextKey = (typeof CONTEXT_KEYS)[number];

/** `null`: the component takes every attribute as a prop (a functional
 * component with no `props` option; Vue then falls only class, style and
 * listeners through to its root). Otherwise the set of declared prop names,
 * collected across `props`, `extends` and `mixins` the way Vue normalizes
 * them. An async wrapper reports its resolved component's declaration and
 * nothing before it resolves. */
const declaredCache = new WeakMap<object, ReadonlySet<string> | null>();
function collectDeclared(source: unknown, into: Set<string>, seen: Set<object>): void {
  if (!source || (typeof source !== 'object' && typeof source !== 'function') || seen.has(source)) return;
  seen.add(source);
  const options = source as {
    props?: unknown;
    extends?: unknown;
    mixins?: unknown;
    __asyncResolved?: unknown;
  };
  if (options.__asyncResolved) collectDeclared(options.__asyncResolved, into, seen);
  const props = options.props;
  if (Array.isArray(props)) {
    for (const name of props) if (typeof name === 'string') into.add(name);
  } else if (props && typeof props === 'object') {
    for (const name of Object.keys(props)) into.add(name);
  }
  collectDeclared(options.extends, into, seen);
  if (Array.isArray(options.mixins)) for (const mixin of options.mixins) collectDeclared(mixin, into, seen);
}
function declaredProps(component: object): ReadonlySet<string> | null {
  let declared = declaredCache.get(component);
  if (declared !== undefined) return declared;
  const options = component as { props?: unknown; __asyncResolved?: unknown };
  const functional = typeof component === 'function' && options.props === undefined;
  if (functional) declared = null;
  else {
    const set = new Set<string>();
    collectDeclared(component, set, new Set());
    declared = set;
  }
  // An unresolved async wrapper is not cached: its declaration is known
  // only once it has loaded.
  if (!('__asyncResolved' in options) || options.__asyncResolved) declaredCache.set(component, declared);
  return declared;
}
function contextProps(
  component: object,
  context: MarkdownElementContext
): Partial<Pick<MarkdownElementContext, ContextKey>> {
  const declared = declaredProps(component);
  const out: Partial<Pick<MarkdownElementContext, ContextKey>> = {};
  for (const key of CONTEXT_KEYS) if (declared === null || declared.has(key)) out[key] = context[key] as never;
  return out;
}
const text = (node: RootContent): string =>
  node.type === 'text' ? node.value : 'children' in node ? node.children.map(text).join('') : '';

/** Key of a top-level child, the same scheme React's block planner uses.
 * Positioned nodes key by source start offset, so an append leaves every
 * earlier block's key in place and a same-offset rewrite keeps its
 * instance; a prepend shifts every offset and remounts the shifted blocks
 * rather than moving a block's component state onto its new neighbour,
 * which is what Vue's positional pairing of unkeyed siblings did. The
 * footnote section carries no position and there is at most one per root
 * (the local one or the aggregate), so it takes a fixed key; any other
 * position-less child keys by index. */
function blockKey(node: RootContent, index: number): string {
  if (node.type === 'element' && isFootnoteSection(node)) return '__footnote_section__';
  const offset = node.position?.start.offset;
  if (offset === undefined) return `inline-i${index}`;
  return node.type === 'element' ? `block-${offset}` : `inline-${offset}`;
}

/** Attach a key to what `convert` produced for a top-level child. Text and
 * nothing cannot carry a key; a slot that returned several children is
 * wrapped in one keyed fragment. */
function keyedChild(child: VNodeChild, key: string): VNodeChild {
  if (child === null || child === undefined || typeof child !== 'object') return child;
  if (isVNode(child)) return cloneVNode(child, { key });
  return h(Fragment, { key }, child);
}

/** Clone before final URL conversion: render must not mutate parser or registry trees. */
export function renderTree(tree: Root, options: RenderOptions): VNodeChild[] {
  return convertTree(tree, options, true);
}

/** `keyed` only for a frame root: the children of the wrapper `div` are
 * the siblings Vue pairs across frames. Placeholder subtrees materialized
 * inside a block (footnote marks) must stay unkeyed, otherwise two marks
 * in one paragraph would share a key. */
function convertTree(tree: Root, options: RenderOptions, keyed: boolean): VNodeChild[] {
  const root = cloneHastForRender(tree);
  visit(
    root,
    buildTransform({
      urlTransform: options.urlTransform,
      allowedElements: undefined,
      disallowedElements: undefined,
      allowElement: undefined,
      skipHtml: true,
      unwrapDisallowed: undefined,
    })
  );
  function element(node: Element, children: VNodeChild[], inSvg: boolean): VNodeChild {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.properties)) {
      const info = find(inSvg ? svg : html, key);
      const name = key === 'className' ? 'class' : info.attribute;
      if (!allowedProperty(key, name)) continue;
      properties[name] = Array.isArray(value) ? value.join(info.commaSeparated ? ', ' : ' ') : value;
    }
    const context: MarkdownElementContext = {
      node,
      properties,
      children,
      streaming: options.streaming,
      metadata: options.metadata,
    };
    const slot = options.slots[node.tagName];
    if (slot) return slot(context);
    const component = options.components[node.tagName];
    // Context props go only to components that declare them. An undeclared
    // prop is an attribute to Vue and falls through to the component's root
    // element: SSR would emit `streaming="true"` and `[object Object]` for
    // `node` and `metadata`.
    return component
      ? h(component, { ...properties, ...contextProps(component, context) }, { default: () => children })
      : h(node.tagName, properties, children);
  }
  function convert(node: RootContent, inSvg = false): VNodeChild {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return null;
    const p = node.properties;
    const children = node.children.map((child) =>
      convert(child, (inSvg || node.tagName === 'svg') && node.tagName !== 'foreignObject')
    );
    if (node.tagName === 'footnote-sup') {
      const label = String(p.label ?? '');
      const number = options.registry?.globalNumber(label) ?? positive(p.localNumber);
      if (number === null) return null;
      const local = positive(p.localOccurrence);
      const globalNumber = options.registry?.globalNumber(label) ?? null;
      const occurrence =
        globalNumber !== null && options.sym && local !== null
          ? options.registry!.globalOccurrenceForRef(options.sym, label, local)
          : globalNumber === null
            ? local
            : null;
      const suffix = occurrence !== null && occurrence > 1 ? `-${occurrence}` : '';
      const prefix = options.clobberPrefix;
      const safe = footnoteSafeId(label);
      // Materialized placeholders must use the same URL policy and element
      // overrides as ordinary HAST, including after mounted coordination.
      return convertTree(
        {
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'sup',
              properties: {},
              children: [
                {
                  type: 'element',
                  tagName: 'a',
                  properties: {
                    href: `#${prefix}fn-${safe}`,
                    id: occurrence !== null || local === null ? `${prefix}fnref-${safe}${suffix}` : undefined,
                    dataFootnoteRef: '',
                    ariaDescribedBy: globalNumber === null ? [`${prefix}footnote-label`] : undefined,
                  },
                  children: [{ type: 'text', value: String(number) }],
                },
              ],
            },
          ],
        },
        options,
        false
      );
    }
    if (node.tagName === 'cross-chunk-link' || node.tagName === 'cross-chunk-image') {
      const image = node.tagName === 'cross-chunk-image';
      const label = String(p.label ?? '');
      const def =
        options.registry?.resolveLinkDef(String(p.identifier ?? label)) ??
        (typeof p.localUrl === 'string'
          ? { url: p.localUrl, title: typeof p.localTitle === 'string' ? p.localTitle : undefined }
          : null);
      if (!def) {
        const content = image ? String(p.alt ?? '') : node.children.map(text).join('');
        const literal =
          p.referenceType === 'full'
            ? `[${content}][${label}]`
            : p.referenceType === 'collapsed'
              ? `[${image ? content : label}][]`
              : `[${label}]`;
        return (image ? '!' : '') + literal;
      }
      const result = resolveCrossChunkReference(
        { tagName: image ? 'img' : 'a', url: def.url, title: def.title, alt: String(p.alt ?? ''), node },
        options.sanitizeSchema,
        options.urlTransform,
        options.clobberPrefix
      );
      return result.element
        ? element(result.element, image ? [] : children, inSvg)
        : result.keepChildren
          ? children
          : null;
    }
    return element(node, children, inSvg || node.tagName === 'svg');
  }
  return root.children.map((node, index) => {
    const child = convert(node);
    return keyed ? keyedChild(child, blockKey(node, index)) : child;
  });
}
