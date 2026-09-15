/**
 * F29 — an end tag parse5 DISCARDS because a SPECIAL element sits above its
 * element on the open-element stack.
 *
 * parse5's "any other end tag" rule (`genericEndTagInBody`) walks the stack
 * from the top: a matching element pops, a special element met first ends
 * the walk and the token is dropped. The scope-barrier walk (F7) stopped at
 * the barrier subset only, so
 *
 *   <span>
 *   <div>
 *   </span>
 *   </div>
 *
 * read as balanced while parse5 kept the span open and nested the rest of
 * the document inside it. Formatting names run the adoption agency instead
 * and are not affected; the block names and the other named cases of
 * `endTagInBody` walk with scope rules the barrier set already models.
 *
 * Two things are pinned here. The name sets are compared with the parse5
 * copy that `hast-util-raw` actually loads (resolved through the dependency
 * chain, never transcribed), so a parse5 bump that moves a name fails this
 * file rather than drifting silently. And the split between the generic
 * walk and the named cases is measured on parse5 itself, because that switch
 * is not exported: for a generic name the text after the discarded end tag
 * stays INSIDE the element, for a named case it does not.
 */
import { describe, expect, test } from 'vitest';

import { computeFreezeBoundary } from './computeFreezeBoundary';
import { P5_FORMATTING_NAMES, P5_SPECIAL_NAMES, SCOPE_BARRIER_NAMES, takesGenericEndTagRule } from './freezeLineSyntax';
import { scheduleSnapshots } from './fuzzGenerators';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { CATALOG } from './testPluginCatalog';

interface Parse5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: Parse5Node[];
}
interface Parse5Module {
  html: {
    /** Tag names by constant (`DIV: 'div'`); the sets below hold numeric ids. */
    TAG_NAMES: Record<string, string>;
    getTagID(name: string): number;
    SPECIAL_ELEMENTS: Record<string, Set<number>>;
  };
  parseFragment: (html: string) => Parse5Node;
}
interface RequireLike {
  (id: string): unknown;
  resolve(id: string): string;
}

/** The parse5 `hast-util-raw` runs: engine → @ai-markdown/rehype-raw →
 *  hast-util-raw → parse5, each hop resolved from the previous file. The
 *  package ships no node types (see boundaryDiff.test.ts), so `node:module`
 *  comes in through a computed dynamic import against a local interface. */
async function loadParse5(): Promise<Parse5Module> {
  const { createRequire } = (await import('node' + ':module')) as unknown as {
    createRequire: (from: string) => RequireLike;
  };
  const fromHere = createRequire(import.meta.url);
  const rehypeRaw = fromHere.resolve('@ai-markdown/rehype-raw');
  const hastUtilRaw = createRequire(rehypeRaw).resolve('hast-util-raw');
  const parse5 = createRequire(hastUtilRaw).resolve('parse5');
  return fromHere(parse5) as Parse5Module;
}

const parse5 = await loadParse5();

/** Text of every text node under `node`, in order. */
function textUnder(node: Parse5Node): string {
  if (node.nodeName === '#text') return node.value ?? '';
  return (node.childNodes ?? []).map(textUnder).join('');
}

/** Element named `name` anywhere in the fragment, first in document order. */
function findElement(node: Parse5Node, name: string): Parse5Node | null {
  if (node.tagName === name) return node;
  for (const child of node.childNodes ?? []) {
    const hit = findElement(child, name);
    if (hit !== null) return hit;
  }
  return null;
}

describe('the special-element set is parse5 own list', () => {
  test('P5_SPECIAL_NAMES equals SPECIAL_ELEMENTS across all namespaces', () => {
    // The sets hold numeric tag ids; map them back through the name table.
    const expected = new Set<string>();
    const names = Object.values(parse5.html.TAG_NAMES);
    for (const ids of Object.values(parse5.html.SPECIAL_ELEMENTS)) {
      for (const name of names) if (ids.has(parse5.html.getTagID(name))) expected.add(name.toLowerCase());
    }
    expect(expected.size).toBeGreaterThan(80);
    expect([...P5_SPECIAL_NAMES].sort()).toEqual([...expected].sort());
  });

  test('every scope barrier is special', () => {
    // The walk keeps the barrier check as a separate clause; the generic
    // rule only ever adds stops on top of it.
    for (const name of SCOPE_BARRIER_NAMES) expect(P5_SPECIAL_NAMES.has(name), name).toBe(true);
  });
});

describe('generic versus named end tags, measured on parse5', () => {
  /** `<N><div></N>x</div>y`: a generic `</N>` is discarded (div is special),
   *  so `y` stays inside N. A named case pops through the div (address-like)
   *  or closes N by the adoption agency (formatting), so `y` lands outside. */
  const yInside = (name: string): boolean => {
    const fragment = parse5.parseFragment(`<${name}><div></${name}>x</div>y`);
    const element = findElement(fragment, name);
    if (element === null) throw new Error(`parse5 built no <${name}>`);
    return textUnder(element).includes('y');
  };

  const GENERIC = ['span', 'sup', 'kbd', 'abbr', 'cite', 'mark', 'label', 'ruby', 'bdi', 'q', 'x-custom', 'td-cell'];
  for (const name of GENERIC) {
    test(`${name}: generic, the end tag is dropped and the element stays open`, () => {
      expect(takesGenericEndTagRule(name)).toBe(true);
      expect(yInside(name)).toBe(true);
    });
  }

  for (const name of P5_FORMATTING_NAMES) {
    test(`${name}: formatting, the adoption agency closes it`, () => {
      expect(takesGenericEndTagRule(name)).toBe(false);
      expect(yInside(name)).toBe(false);
    });
  }

  for (const name of ['dialog', 'search']) {
    test(`${name}: named and not special, pops through the div`, () => {
      expect(takesGenericEndTagRule(name)).toBe(false);
      expect(P5_SPECIAL_NAMES.has(name)).toBe(false);
      expect(yInside(name)).toBe(false);
    });
  }

  test('special names never take the generic rule', () => {
    for (const name of P5_SPECIAL_NAMES) expect(takesGenericEndTagRule(name), name).toBe(false);
  });
});

describe('scanner direction', () => {
  const boundary = (text: string) => computeFreezeBoundary(text, { defListEnabled: false }).boundary;
  const TAIL = '\n\nfiller para\n\ntail paragraph with text\n';

  const DISCARDED: string[] = [
    '<span>\n<div>\n</span>\n</div>',
    '<span><div></span></div>',
    '<span>\n<pre>\n</span>\n</pre>',
    '<span>\n<p>\n</span>\n</p>',
    '<span>\n<ul>\n</span>\n</ul>',
    '<sup>\n<div>\n</sup>\n</div>',
    '<kbd>\n<div>\n</kbd>\n</div>',
    '<x-custom>\n<section>\n</x-custom>\n</section>',
    // Nested one level down: the special element is not the top of the
    // stack when `</span>` arrives, only somewhere above the span.
    '<span>\n<div>\n<em>\n</em>\n</span>\n</div>',
  ];
  for (const shape of DISCARDED) {
    test(`${JSON.stringify(shape)}: the element stays open, nothing past it freezes`, () => {
      expect(boundary(`${shape}${TAIL}`)).toBeLessThanOrEqual(shape.indexOf('\n') === -1 ? 0 : shape.indexOf('\n') + 1);
    });
  }

  const RELEASED: string[] = [
    // Formatting names: the adoption agency closes them.
    '<b>\n<div>\n</b>\n</div>',
    '<em>\n<div>\n</em>\n</div>',
    // No special element above the span when its end tag arrives.
    '<span>\n<em>\n</em>\n</span>',
    '<div>\n<span>\n</span>\n</div>',
    // Named, not special: the in-scope walk pops through the div.
    '<dialog>\n<div>\n</dialog>\n</div>',
  ];
  for (const shape of RELEASED) {
    test(`${JSON.stringify(shape)}: still freezes past the block`, () => {
      expect(boundary(`${shape}${TAIL}`)).toBeGreaterThan(shape.length);
    });
  }

  // Accepted price. parse5 pops the span when the OUTER `</div>` fires
  // (implied end tags, pop through), so the document is balanced again;
  // the walk removes only the matched element, as it always has (see the
  // F7 note on formatting names), so the discarded span stays counted and
  // nothing after it freezes. Before F29 this shape froze because the
  // discarded `</span>` was applied. Over-block only; the equivalence pin in
  // tagNamePrefixAxis.test.ts covers the output.
  test('outer special end tag after a discarded end tag: over-blocked, not released', () => {
    expect(boundary(`<div>\n<span>\n<div>\n</span>\n</div>\n</div>${TAIL}`)).toBe(0);
  });
});

describe('every frame equals a full parse', () => {
  const DOCS: Array<[string, string]> = [
    ['span/div block', '<span>\n<div>\n</span>\n</div>\n\npara\n'],
    ['span/div one line', '<span><div></span></div>\n\npara\n'],
    ['custom/section block', '<x-custom>\n<section>\n</x-custom>\n</section>\n\n*b*\n'],
    ['span over a nested formatting pair', '<span>\n<div>\n<em>\n</em>\n</span>\n</div>\n\n*b*\n'],
    ['dialog control', '<dialog>\n<div>\n</dialog>\n</div>\n\n*b*\n'],
  ];
  for (const [name, doc] of DOCS) {
    test(name, () => {
      for (const config of CATALOG) {
        for (const schedule of [[1], [4, 4, 4, 1], [3, 30]]) {
          assertStreamEquivalence(name, scheduleSnapshots(doc, schedule), config, { minIncrementalFrames: 0 });
        }
      }
    });
  }
});
