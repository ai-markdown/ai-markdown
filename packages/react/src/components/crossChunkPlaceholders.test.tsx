import { describe, test, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { AIMarkdownDocuments, __internalGetContext } from './AIMarkdownDocuments';
import { ChunkSymbolContext } from './chunkSymbolContext';
import { CrossChunkUrlContext, type CrossChunkUrlPolicy } from './crossChunkUrlContext';
import AIMarkdownProvider from '../context';
import { CrossChunkImage, CrossChunkLink, FootnoteSupNumber } from './crossChunkPlaceholders';
import { defaultUrlTransform } from './markdown';
import { extendSanitizeSchema } from '@ai-markdown/engine';
import { sanitizeSchema as defaultLibrarySchema } from '@ai-markdown/engine';

function WithProvider({
  children,
  documentId,
  policy,
}: {
  children: ReactNode;
  documentId: string;
  /** Optional override for the cross-chunk URL policy context. When omitted
   *  the placeholders fall back to the library defaults inside the
   *  components themselves — useful for verifying that fallback path. */
  policy?: CrossChunkUrlPolicy;
}) {
  const inner = (
    <AIMarkdownProvider streaming={false} fontSize="14px" variant="default" colorScheme="light" documentId={documentId}>
      {children}
    </AIMarkdownProvider>
  );
  return (
    <AIMarkdownDocuments>
      {policy ? <CrossChunkUrlContext.Provider value={policy}>{inner}</CrossChunkUrlContext.Provider> : inner}
    </AIMarkdownDocuments>
  );
}

function SeedRegistryMidFlight({ children }: { children: ReactNode }) {
  const ctx = __internalGetContext();
  const registry = ctx!.getRegistry('doc');
  const existing = registry.allocateSymbol('existing');
  registry.contributeChunkData(existing, {
    refs: [{ label: 'X', kind: 'footnote' }],
    defs: new Map(),
    linkDefs: new Map(),
    ownFootnoteLabels: new Set(),
    ownLinkLabels: new Set(),
  });
  const pending = registry.allocateSymbol('pending');
  return <ChunkSymbolContext.Provider value={pending}>{children}</ChunkSymbolContext.Provider>;
}

describe('crossChunkPlaceholders', () => {
  test('FootnoteSupNumber accepts STRING localOccurrence (post-rehype-raw shape)', () => {
    // rehype-raw's parse5 round-trip stringifies numeric hast properties.
    // FootnoteSupNumber must coerce the wire-shape to compute the right
    // global occurrence — `typeof === 'number'` is the wrong gate.
    function SeedAndRender({ occurrence }: { occurrence: number | string }) {
      const ctx = __internalGetContext();
      const reg = ctx!.getRegistry('doc');
      const sym = reg.allocateSymbol('chunk1');
      reg.contributeChunkData(sym, {
        refs: [
          { label: 'X', kind: 'footnote' },
          { label: 'X', kind: 'footnote' },
        ],
        defs: new Map([['X', { identifier: 'X', sourceIdentifier: 'x', contentSource: 'b' }]]),
        linkDefs: new Map(),
        ownFootnoteLabels: new Set(['X']),
        ownLinkLabels: new Set(),
      });
      return (
        <ChunkSymbolContext.Provider value={sym}>
          <FootnoteSupNumber label="X" localOccurrence={occurrence as number} />
        </ChunkSymbolContext.Provider>
      );
    }
    // Numeric input — standard pre-pipeline shape.
    const htmlNum = renderToString(
      <WithProvider documentId="doc">
        <SeedAndRender occurrence={2} />
      </WithProvider>
    );
    // String input — what rehype-raw actually emits.
    const htmlStr = renderToString(
      <WithProvider documentId="doc">
        <SeedAndRender occurrence={'2'} />
      </WithProvider>
    );
    // Both render the second-occurrence backref id `fnref-x-2`.
    expect(htmlNum).toContain('fnref-x-2');
    expect(htmlStr).toContain('fnref-x-2');
  });

  test('FootnoteSupNumber renders empty when registry has no number for the label', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <FootnoteSupNumber label="X" />
      </WithProvider>
    );
    // No <sup>, no <a data-footnote-ref>, no rendered number content.
    expect(html).not.toContain('<sup');
    expect(html).not.toContain('data-footnote-ref');
  });

  test('FootnoteSupNumber shows the global number while its own occurrence is still unregistered', () => {
    // The label is numbered (another chunk contributed it) but THIS chunk's
    // occurrence is not in the registry yet — contribute effect pending, or
    // permanently for a ref inside a footnote definition body (contributions
    // skip definition bodies). It used to render nothing (2026-08-19 review;
    // oracle F2): the number is right either way, so show it — without an
    // id (no footer backref will ever target this ref, and a chunk-local id
    // would collide with another chunk's real `fnref-x` mark).
    const html = renderToString(
      <WithProvider documentId="doc">
        <SeedRegistryMidFlight>
          <FootnoteSupNumber label="X" localOccurrence={1} />
        </SeedRegistryMidFlight>
      </WithProvider>
    );
    expect(html).toContain('data-footnote-ref');
    expect(html).not.toContain('fnref-x');
    expect(html).toContain('>1</a>');
    const second = renderToString(
      <WithProvider documentId="doc">
        <SeedRegistryMidFlight>
          <FootnoteSupNumber label="X" localOccurrence={2} localNumber={4} />
        </SeedRegistryMidFlight>
      </WithProvider>
    );
    // Global number, not the chunk-local one.
    expect(second).not.toContain('fnref-x');
    expect(second).toContain('>1</a>');
    expect(second).not.toContain('>4</a>');
  });

  test('FootnoteSupNumber on a chunk without a symbol yet still shows a known number (no id)', () => {
    // A chunk's first frame: `chunkSym` is state and still null while the
    // registry already numbers the label (another chunk contributed). Used
    // to render nothing (r2 P3 carry-over of the 2.4.5 fix).
    function SeedNoSymbol({ children }: { children: ReactNode }) {
      const ctx = __internalGetContext();
      const registry = ctx!.getRegistry('doc');
      const existing = registry.allocateSymbol('existing');
      registry.contributeChunkData(existing, {
        refs: [{ label: 'X', kind: 'footnote' }],
        defs: new Map(),
        linkDefs: new Map(),
        ownFootnoteLabels: new Set(),
        ownLinkLabels: new Set(),
      });
      return <>{children}</>;
    }
    const html = renderToString(
      <WithProvider documentId="doc">
        <SeedNoSymbol>
          <FootnoteSupNumber label="X" localOccurrence={1} />
        </SeedNoSymbol>
      </WithProvider>
    );
    expect(html).toContain('data-footnote-ref');
    expect(html).toContain('>1</a>');
    expect(html).not.toContain('fnref-x');
  });

  test('CrossChunkLink fallback flattens rich children to plain text (no [object Object])', () => {
    // When the [text] slot contained inline markup like `[**bold**][X]`,
    // react-markdown hands CrossChunkLink a React element tree as children.
    // The previous `String(children?.toString?.())` path produced literal
    // `[object Object]` in the fallback. The fix walks the children tree
    // and concatenates text content.
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkLink label="X" referenceType="full">
          <strong>bold</strong> text
        </CrossChunkLink>
      </WithProvider>
    );
    expect(html).not.toContain('[object Object]');
    expect(html).toContain('[bold text][X]');
  });

  test('CrossChunkLink fallback handles nested + array children', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkLink label="X" referenceType="full">
          {[
            'a',
            <em key="e">b</em>,
            <span key="s">
              <code>c</code>
            </span>,
          ]}
        </CrossChunkLink>
      </WithProvider>
    );
    expect(html).toContain('[abc][X]');
  });

  test('CrossChunkLink referenceType=full → fallback `[click][X]`', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkLink label="X" referenceType="full">
          click
        </CrossChunkLink>
      </WithProvider>
    );
    expect(html).toContain('[click][X]');
    // No anchor element rendered on fallback path.
    expect(html).not.toContain('<a ');
  });

  test('CrossChunkLink referenceType=shortcut → fallback `[X]`', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkLink label="X" referenceType="shortcut">
          X
        </CrossChunkLink>
      </WithProvider>
    );
    expect(html).toContain('[X]');
    expect(html).not.toContain('[X][');
    expect(html).not.toContain('<a ');
  });

  test('CrossChunkLink referenceType=collapsed → fallback `[X][]`', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkLink label="X" referenceType="collapsed">
          X
        </CrossChunkLink>
      </WithProvider>
    );
    expect(html).toContain('[X][]');
    expect(html).not.toContain('<a ');
  });

  test('CrossChunkImage referenceType=full → fallback `![alt text][X]`', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkImage label="X" referenceType="full" alt="alt text" />
      </WithProvider>
    );
    expect(html).toContain('![alt text][X]');
    expect(html).not.toContain('<img');
  });
});

describe('crossChunkPlaceholders — URL sanitization (render-time two-gate)', () => {
  // These tests pin the render-time symmetry contract: cross-chunk
  // link/image placeholders must observable-match the standalone hast pass.
  // The placeholders bypass `transform.ts` + `rehype-sanitize`'s protocols
  // gate because their URL is read from the registry AFTER both gates have
  // already run for in-tree elements. `sanitizeCrossChunkUrl` is the
  // explicit re-application.

  function seedAndRenderLink(rawUrl: string, policy?: CrossChunkUrlPolicy): string {
    function Seed() {
      const ctx = __internalGetContext();
      const reg = ctx!.getRegistry('doc');
      const sym = reg.allocateSymbol('seed');
      reg.contributeChunkData(sym, {
        refs: [],
        defs: new Map(),
        linkDefs: new Map([['X', { identifier: 'X', url: rawUrl }]]),
        ownFootnoteLabels: new Set(),
        ownLinkLabels: new Set(['X']),
      });
      return (
        <CrossChunkLink label="X" referenceType="full">
          click
        </CrossChunkLink>
      );
    }
    return renderToString(
      <WithProvider documentId="doc" policy={policy}>
        <Seed />
      </WithProvider>
    );
  }

  function seedAndRenderImage(rawUrl: string, policy?: CrossChunkUrlPolicy): string {
    function Seed() {
      const ctx = __internalGetContext();
      const reg = ctx!.getRegistry('doc');
      const sym = reg.allocateSymbol('seed');
      reg.contributeChunkData(sym, {
        refs: [],
        defs: new Map(),
        linkDefs: new Map([['X', { identifier: 'X', url: rawUrl }]]),
        ownFootnoteLabels: new Set(),
        ownLinkLabels: new Set(['X']),
      });
      return <CrossChunkImage label="X" referenceType="full" alt="pic" />;
    }
    return renderToString(
      <WithProvider documentId="doc" policy={policy}>
        <Seed />
      </WithProvider>
    );
  }

  test('CrossChunkLink resolves a PADDED source label against the trimmed def key (eng-stream-01)', () => {
    // The handler forwards mdast's original label (`[ X ]` → ' X '); the
    // registry def is keyed 'X'. Before normalizeId trimmed, this rendered
    // the literal fallback in coordinated mode while standalone resolved.
    function Seed() {
      const ctx = __internalGetContext();
      const reg = ctx!.getRegistry('doc');
      const sym = reg.allocateSymbol('seed');
      reg.contributeChunkData(sym, {
        refs: [],
        defs: new Map(),
        linkDefs: new Map([['X', { identifier: 'X', url: 'https://example.com/padded' }]]),
        ownFootnoteLabels: new Set(),
        ownLinkLabels: new Set(['X']),
      });
      return (
        <CrossChunkLink label={' x\n'} referenceType="shortcut">
          click
        </CrossChunkLink>
      );
    }
    const html = renderToString(
      <WithProvider documentId="doc">
        <Seed />
      </WithProvider>
    );
    expect(html).toContain('href="https://example.com/padded"');
    expect(html).not.toContain('[');
  });

  test("localUrl fallback: renders the chunk's own def while the registry has nothing (SSR / first frame)", () => {
    // No seeding at all — the registry exists (wrapper) but is empty.
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkLink label="own" referenceType="full" localUrl="https://example.com/own" localTitle="T">
          click
        </CrossChunkLink>
        <CrossChunkImage label="own" referenceType="full" alt="pic" localUrl="https://example.com/pic.png" />
      </WithProvider>
    );
    expect(html).toContain('href="https://example.com/own"');
    expect(html).toContain('title="T"');
    expect(html).toContain('src="https://example.com/pic.png"');
    expect(html).not.toContain('[click]');
  });

  test('a registry (canonical) def wins over localUrl once it exists', () => {
    function Seed() {
      const ctx = __internalGetContext();
      const reg = ctx!.getRegistry('doc');
      const sym = reg.allocateSymbol('seed');
      reg.contributeChunkData(sym, {
        refs: [],
        defs: new Map(),
        linkDefs: new Map([['X', { identifier: 'X', url: 'https://example.com/canonical' }]]),
        ownFootnoteLabels: new Set(),
        ownLinkLabels: new Set(['X']),
      });
      return (
        <CrossChunkLink label="X" referenceType="full" localUrl="https://example.com/local">
          click
        </CrossChunkLink>
      );
    }
    const html = renderToString(
      <WithProvider documentId="doc">
        <Seed />
      </WithProvider>
    );
    expect(html).toContain('href="https://example.com/canonical"');
    expect(html).not.toContain('example.com/local');
  });

  test('localUrl runs through the render-time URL gates too (javascript: stripped)', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkLink label="own" referenceType="full" localUrl="javascript:alert(1)">
          click
        </CrossChunkLink>
      </WithProvider>
    );
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<a');
  });

  test('FootnoteSupNumber falls back to the local number while the registry has no global number', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <FootnoteSupNumber label="a" localOccurrence={2} localNumber={3} />
      </WithProvider>
    );
    // Standalone shape: local number, `-N` by local occurrence, same
    // attribute set mdast-util-to-hast emits.
    expect(html).toContain('>3</a>');
    expect(html).toContain('id="doc-user-content-fnref-a-2"');
    expect(html).toContain('aria-describedby="doc-user-content-footnote-label"');
    // A phantom ref (no local number) still renders nothing.
    const phantom = renderToString(
      <WithProvider documentId="doc">
        <FootnoteSupNumber label="a" localOccurrence={1} />
      </WithProvider>
    );
    expect(phantom).not.toContain('<sup');
  });

  test('CrossChunkLink strips javascript: even if the registry stored it raw (defense-in-depth)', () => {
    // Bypass the contribute-time gate by seeding the registry directly with
    // a malicious URL — verifies the render-time gate ALONE is sufficient.
    const html = seedAndRenderLink('javascript:alert(1)');
    expect(html).not.toContain('javascript:');
    // The <a> still renders WITHOUT an href attribute — exactly what
    // standalone `rehype-sanitize` does to a protocol-blocked in-tree `<a>`
    // (it drops the attribute; it does not unwrap the element and it does
    // not leave `href=""` — that shape is reserved for a legally EMPTY
    // destination, see below). v2.4.2 review P1-4 locked the shape.
    expect(html).toContain('<a>click</a>');
    expect(html).not.toContain('href=');
  });

  test('CrossChunkLink keeps href="" for a legally empty definition URL (`[x]: <>`)', () => {
    const html = seedAndRenderLink('');
    expect(html).toContain('<a href="">click</a>');
  });

  test('CrossChunkImage strips javascript: src (defense-in-depth)', () => {
    const html = seedAndRenderImage('javascript:alert(1)');
    expect(html).not.toContain('javascript:');
    // The <img> still renders (with empty src), matching standalone.
    expect(html).toContain('<img');
  });

  test('a rewriting urlTransform is applied exactly once (registry stores the raw URL)', () => {
    // v2.4.2 review P1-4: the contribute-time pre-pass used to run the
    // transform once more before the render gate — `proxy(proxy(url))`.
    const policy: CrossChunkUrlPolicy = {
      urlTransform: (url) => `https://proxy.example/?u=${encodeURIComponent(url)}`,
      sanitizeSchema: defaultLibrarySchema,
    };
    const html = seedAndRenderLink('https://example.com/x', policy);
    expect(html).toContain('href="https://proxy.example/?u=https%3A%2F%2Fexample.com%2Fx"');
    expect(html).not.toContain('proxy.example%2F');
  });

  test('CrossChunkLink renders an https:// def via default policy', () => {
    const html = seedAndRenderLink('https://example.com/x');
    expect(html).toContain('href="https://example.com/x"');
  });

  test('CrossChunkLink honors a policy whose schema removes a default protocol', () => {
    // Adversarial schema: drop `mailto` from protocols.href. Standalone
    // would strip the href; cross-chunk must do the same.
    const schema = extendSanitizeSchema((s) => {
      s.protocols!.href = s.protocols!.href!.filter((p) => p !== 'mailto');
    });
    const html = seedAndRenderLink('mailto:a@b.com', {
      urlTransform: defaultUrlTransform,
      sanitizeSchema: schema,
    });
    expect(html).not.toContain('mailto:');
  });

  test('CrossChunkLink + a custom myapp scheme requires BOTH gates to permit it', () => {
    const allowMyappTransform = (url: string, key: string, node: Parameters<typeof defaultUrlTransform>[2]) =>
      /^myapp:/i.test(url) ? url : defaultUrlTransform(url, key, node);

    // Gate 1 (urlTransform) allows, gate 2 (schema) does NOT.
    const halfOpenPolicy: CrossChunkUrlPolicy = {
      urlTransform: allowMyappTransform,
      sanitizeSchema: defaultLibrarySchema, // myapp NOT in protocols.href
    };
    expect(seedAndRenderLink('myapp://thing', halfOpenPolicy)).not.toContain('myapp://');

    // Both gates open → the scheme passes through.
    const fullOpenSchema = extendSanitizeSchema((s) => {
      s.protocols!.href!.push('myapp');
    });
    const fullOpenPolicy: CrossChunkUrlPolicy = {
      urlTransform: allowMyappTransform,
      sanitizeSchema: fullOpenSchema,
    };
    expect(seedAndRenderLink('myapp://thing', fullOpenPolicy)).toContain('href="myapp://thing"');
  });

  test('Asymmetric schema: href allows myapp, src does NOT — image variant is stripped', () => {
    // This is the exact codex-flagged scenario: a key-aware policy where
    // `<a href>` allows the scheme but `<img src>` does not. Standalone
    // enforces the asymmetry via `protocols.href` vs `protocols.src`;
    // cross-chunk must observe the same.
    const allowAll = (url: string) => url;
    const asymmetric = extendSanitizeSchema((s) => {
      s.protocols!.href!.push('myapp');
      // deliberately NOT mutating protocols.src
    });
    const policy: CrossChunkUrlPolicy = {
      urlTransform: allowAll,
      sanitizeSchema: asymmetric,
    };
    expect(seedAndRenderLink('myapp://thing', policy)).toContain('href="myapp://thing"');
    expect(seedAndRenderImage('myapp://thing', policy)).not.toContain('myapp://');
  });

  test('Key-aware urlTransform: blocks tracker pixels on <img> but allows on <a>', () => {
    // A common real-world pattern: allow a tracker URL as a clickable link
    // (user opted in by clicking) but never as a <img src> (silent
    // tracking pixel). Cross-chunk must honor key-awareness. Modeled here
    // as a urlTransform that explicitly returns '' for the `src` key —
    // this is the literal user opt-in: "I never want this URL as image
    // src no matter what."
    const onlyHref = (url: string, key: string) => (key === 'href' ? url : '');
    const policy: CrossChunkUrlPolicy = {
      urlTransform: onlyHref,
      sanitizeSchema: defaultLibrarySchema,
    };
    expect(seedAndRenderLink('https://tracker.example/x', policy)).toContain('href="https://tracker.example/x"');
    // Image must NOT include the URL — onlyHref returned '' for src.
    const imgHtml = seedAndRenderImage('https://tracker.example/x', policy);
    expect(imgHtml).not.toContain('https://tracker.example/x');
  });
});

test('globally numbered footnotes use the current URL policy and element overrides', () => {
  const render = (prefix: string) =>
    renderToString(
      <WithProvider
        documentId="doc"
        policy={{
          sanitizeSchema: defaultLibrarySchema,
          urlTransform: (url) => `${prefix}${url}`,
          components: {
            a: ({ href, children, node }) => (
              <span data-href={href} data-tag={node?.tagName}>
                {children}
              </span>
            ),
          },
        }}
      >
        <SeedRegistryMidFlight>
          <FootnoteSupNumber label="X" localOccurrence={1} />
        </SeedRegistryMidFlight>
      </WithProvider>
    );
  expect(render('/one')).toContain('data-href="/one#doc-user-content-fn-x" data-tag="a">1</span>');
  expect(render('/two')).toContain('data-href="/two#doc-user-content-fn-x" data-tag="a">1</span>');
});
