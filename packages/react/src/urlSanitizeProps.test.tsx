/**
 * Tests for the public `urlTransform` and `sanitizeSchema` props on
 * `<AIMarkdown>`. These props let consumers extend the default URL allowlist
 * (e.g. to render arbitrary application-private link schemes) without
 * forking the library.
 *
 * The two props must be used TOGETHER to actually render a private scheme
 * as a clickable href: `urlTransform` is the FIRST gate (rewrites disallowed
 * URLs to `''`), and `rehype-sanitize`'s protocol allowlist is the SECOND
 * gate (drops the entire `href` / `src` attribute for non-allowlisted
 * protocols). Defense in depth, by design.
 *
 * Tests below use a generic `myapp:` scheme as the stand-in for any custom
 * non-default protocol — no real protocol/service name is referenced.
 */

import { renderToString, renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import AIMarkdown, { AIMarkdownDocuments, defaultUrlTransform, extendSanitizeSchema } from '.';

describe('AIMarkdown — default URL handling (no custom props)', () => {
  test('strips javascript: hrefs (XSS protection)', () => {
    const html = renderToStaticMarkup(<AIMarkdown content="[click](javascript:alert(1))" />);
    expect(html).not.toContain('javascript:');
  });

  test('strips unknown private schemes by default', () => {
    const html = renderToStaticMarkup(<AIMarkdown content="[click](myapp://thing/X)" />);
    expect(html).not.toContain('myapp://');
  });

  test('preserves https hrefs', () => {
    const html = renderToStaticMarkup(<AIMarkdown content="[click](https://example.com)" />);
    expect(html).toContain('https://example.com');
  });
});

describe('AIMarkdown — `urlTransform` prop (composition with defaultUrlTransform)', () => {
  // Module-scope: the recommended pattern for stable identity across renders.
  const ALLOWED = /^myapp:/i;
  const URL_TRANSFORM = (url: string, key: string, node: Parameters<typeof defaultUrlTransform>[2]) =>
    ALLOWED.test(url) ? url : defaultUrlTransform(url, key, node);

  test('lets a custom transform pass a private scheme through gate 1', () => {
    // Without a matching `sanitizeSchema`, gate 2 still drops the `href`.
    const html = renderToStaticMarkup(<AIMarkdown content="[click](myapp://thing/X)" urlTransform={URL_TRANSFORM} />);
    expect(html).not.toContain('myapp://');
  });

  test('default behavior preserved when prop omitted', () => {
    const html = renderToStaticMarkup(<AIMarkdown content="[mail](mailto:a@b.com)" />);
    expect(html).toContain('mailto:a@b.com');
  });
});

describe('AIMarkdown — `sanitizeSchema` prop (mutate-and-return form via extendSanitizeSchema)', () => {
  const SCHEMA = extendSanitizeSchema((s) => {
    s.protocols!.href!.push('myapp');
  });

  test('accepts a custom schema that extends the protocol allowlist', () => {
    // Without a matching urlTransform, gate 1 strips the URL to '' before
    // sanitize even sees it. So the custom schema alone is also not enough.
    const html = renderToStaticMarkup(<AIMarkdown content="[click](myapp://thing/X)" sanitizeSchema={SCHEMA} />);
    expect(html).not.toContain('myapp://');
  });
});

describe('AIMarkdown — both gates open via the recommended patterns (the real use case)', () => {
  // Module-scope, called once: stable references for both props.
  const ALLOWED = /^myapp:/i;
  const URL_TRANSFORM = (url: string, key: string, node: Parameters<typeof defaultUrlTransform>[2]) =>
    ALLOWED.test(url) ? url : defaultUrlTransform(url, key, node);
  const SCHEMA = extendSanitizeSchema((s) => {
    s.protocols!.href!.push('myapp');
    s.protocols!.src!.push('myapp');
  });

  test('renders an <a> with a private-scheme href when both gates allow it', () => {
    const html = renderToStaticMarkup(
      <AIMarkdown content="[ref](myapp://thing/12345)" urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />
    );
    expect(html).toContain('myapp://thing/12345');
    expect(html).toContain('href="myapp://thing/12345"');
  });

  test('renders an <img> with a private-scheme src when both gates allow it', () => {
    const html = renderToStaticMarkup(
      <AIMarkdown content="![alt](myapp://image/9)" urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />
    );
    expect(html).toContain('myapp://image/9');
    expect(html).toContain('src="myapp://image/9"');
  });

  test('still strips javascript: even with both gates relaxed for myapp', () => {
    // `URL_TRANSFORM` falls through to `defaultUrlTransform` for non-myapp
    // URLs, so javascript: gets nuked at gate 1.
    const html = renderToStaticMarkup(
      <AIMarkdown content="[xss](javascript:alert(1))" urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />
    );
    expect(html).not.toContain('javascript:');
  });

  test('https still works with the relaxed pair', () => {
    const html = renderToStaticMarkup(
      <AIMarkdown content="[link](https://example.com)" urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />
    );
    expect(html).toContain('https://example.com');
  });

  test('cross-chunk tags survive via extendSanitizeSchema (regression guard)', () => {
    // Mutate the schema heavily and confirm cross-chunk tags are still in
    // tagNames. extendSanitizeSchema's whole point is preserving these.
    const ChaosSchema = extendSanitizeSchema((s) => {
      s.protocols!.href!.push('myapp');
      s.protocols!.src!.push('myapp');
      // Even if the user pushes random tags, the cross-chunk ones must
      // remain (they were already there before the modifier ran).
      s.tagNames!.push('my-widget');
    });
    expect(ChaosSchema.tagNames).toContain('cross-chunk-link');
    expect(ChaosSchema.tagNames).toContain('cross-chunk-image');
    expect(ChaosSchema.tagNames).toContain('footnote-sup');
  });
});

describe('AIMarkdown — SSR determinism with semantically equal inputs', () => {
  // What this test ACTUALLY pins:
  //   The whole pipeline (parse → transform → sanitize → render) is
  //   deterministic given semantically-equal inputs. Two calls into a fresh
  //   React tree with the same `documentId` and equivalent `urlTransform` /
  //   `sanitizeSchema` produce byte-identical SSR markup.
  //
  // What this test does NOT pin (despite an earlier name suggesting it did):
  //   That `useStableValue` actually preserves the schema reference across
  //   re-renders of the SAME mounted instance. SSR via `renderToString`
  //   spins up a fresh React tree per call, so the per-instance ref state
  //   inside `useStableValue` cannot be observed across the two renders.
  //   Proving that claim properly would require `@testing-library/react`'s
  //   `render`/`rerender` (not currently in this package's test deps); it
  //   is left as future work since the dev-mode flip warning + the existing
  //   block-memo G3 dep tracking already guard the perf contract.
  test('two SSR renders with equal inputs yield identical markup', () => {
    const renderOnce = () =>
      renderToString(
        <AIMarkdown
          content="[ref](myapp://x)"
          documentId="stable-doc"
          urlTransform={(url, key, node) => (/^myapp:/i.test(url) ? url : defaultUrlTransform(url, key, node))}
          sanitizeSchema={extendSanitizeSchema((s) => {
            s.protocols!.href!.push('myapp');
          })}
        />
      );
    const a = renderOnce();
    const b = renderOnce();
    expect(a).toBe(b);
    expect(a).toContain('href="myapp://x"');
  });
});

describe('coordinated footnote rendering policy', () => {
  const content = 'Body[^a]\n\n[^a]: Note';

  test('the same URL transform handles standalone and coordinated footnote marks', () => {
    const calls: string[] = [];
    const transform = (url: string, key: string, node: Parameters<typeof defaultUrlTransform>[2]) => {
      calls.push(`${node.tagName}:${key}:${url}`);
      return '';
    };
    const child = <AIMarkdown documentId="policy" content={content} urlTransform={transform} />;
    const standalone = renderToStaticMarkup(child);
    calls.length = 0;
    const coordinated = renderToStaticMarkup(<AIMarkdownDocuments>{child}</AIMarkdownDocuments>);
    expect(coordinated).toBe(standalone);
    expect(calls).toContain('a:href:#policy-user-content-fn-a');
    expect(coordinated).not.toContain('href="#');
  });

  test('both sup and anchor overrides receive real footnote elements in coordinated SSR', () => {
    const customComponents = {
      a: ({
        children,
        node,
      }: import('./components/markdown').ExtraProps & { children?: import('react').ReactNode }) => (
        <span data-rendered-tag={node?.tagName}>{children}</span>
      ),
      sup: ({
        children,
        node,
      }: import('./components/markdown').ExtraProps & { children?: import('react').ReactNode }) => (
        <span data-rendered-tag={node?.tagName}>{children}</span>
      ),
    };
    const child = <AIMarkdown documentId="policy" content={content} customComponents={customComponents} />;
    const standalone = renderToStaticMarkup(child);
    const coordinated = renderToStaticMarkup(<AIMarkdownDocuments>{child}</AIMarkdownDocuments>);
    expect(coordinated).toBe(standalone);
    expect(coordinated).toContain('<span data-rendered-tag="sup"><span data-rendered-tag="a">1</span></span>');
    expect(coordinated).not.toContain('<a ');
  });
});
