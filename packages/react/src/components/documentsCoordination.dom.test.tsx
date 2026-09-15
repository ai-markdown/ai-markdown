// @vitest-environment jsdom
/**
 * Coordinated rendering under `<AIMarkdownDocuments>` in a mounted React
 * tree: StrictMode double effects, runtime flips of
 * `preserveOrphanReferences`, and `documentIndex` changes on a mounted
 * chunk. Each case checks what the DOM shows in the NEXT committed render
 * so a stale block-memo frame or a missed registry wake-up would fail
 * here rather than in a browser.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AIMarkdown, { AIMarkdownDocuments, useDocumentRegistry, type Registry } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Counts `parse` calls per pipeline session. A session belongs to one
 *  mounted renderer, so a count that does not move across a render means
 *  the renderer's pipeline memo was not invalidated. */
const parseCalls: number[] = [];
vi.mock('@ai-markdown/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ai-markdown/core')>();
  return {
    ...mod,
    createPipelineSession: () => {
      const session = mod.createPipelineSession();
      const index = parseCalls.push(0) - 1;
      const parse = session.parse.bind(session);
      session.parse = (input) => {
        parseCalls[index]++;
        return parse(input);
      };
      return session;
    },
  };
});

const marks = (scope: ParentNode) => Array.from(scope.querySelectorAll('[data-footnote-ref]'), (el) => el.textContent);
const footers = (scope: ParentNode) => scope.querySelectorAll('section[data-footnotes]');
const footerItems = (scope: ParentNode) =>
  Array.from(scope.querySelectorAll('section[data-footnotes] li'), (el) => el.id);

let container: HTMLDivElement;
let root: Root;
let consoleWarn: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  parseCalls.length = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  consoleWarn.mockRestore();
  consoleError.mockRestore();
});

const render = (element: ReactNode) => act(async () => root.render(element));
const unbalancedReleaseWarnings = () =>
  consoleWarn.mock.calls.map((call: unknown[]) => String(call[0])).filter((w: string) => /unbalanced release/.test(w));

describe('three chunks under StrictMode', () => {
  const A = 'Alpha[^a].\n\n[^a]: Note A';
  const B = 'Beta[^b].\n\n[^b]: Note B';
  const C = 'Gamma[^c].\n\n[^c]: Note C';

  function Document({ second }: { second: string }) {
    return (
      <StrictMode>
        <AIMarkdownDocuments>
          <div data-chunk="a">
            <AIMarkdown documentId="doc" documentIndex={0} content={A} />
          </div>
          <div data-chunk="b">
            <AIMarkdown documentId="doc" documentIndex={1} content={second} />
          </div>
          <div data-chunk="c">
            <AIMarkdown documentId="doc" documentIndex={2} content={C} />
          </div>
        </AIMarkdownDocuments>
      </StrictMode>
    );
  }

  test('mounts balanced, renders one aggregate footer, and renumbers after an append', async () => {
    await render(<Document second={B} />);

    expect(unbalancedReleaseWarnings()).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(footers(container)).toHaveLength(1);
    expect(container.querySelector('[data-chunk="c"] section[data-footnotes]')).not.toBeNull();
    expect(marks(container)).toEqual(['1', '2', '3']);
    expect(footerItems(container)).toEqual(['doc-user-content-fn-a', 'doc-user-content-fn-b', 'doc-user-content-fn-c']);

    await render(<Document second={`${B}\n\nMore[^b2].\n\n[^b2]: Note B2`} />);

    expect(unbalancedReleaseWarnings()).toEqual([]);
    expect(footers(container)).toHaveLength(1);
    expect(marks(container)).toEqual(['1', '2', '3', '4']);
    expect(footerItems(container)).toEqual([
      'doc-user-content-fn-a',
      'doc-user-content-fn-b',
      'doc-user-content-fn-b2',
      'doc-user-content-fn-c',
    ]);
  });
});

describe('runtime flip of preserveOrphanReferences', () => {
  const ORPHAN = 'Body text.\n\n[^x]: Orphan note';

  test('standalone: the footer follows the prop in the very next render', async () => {
    await render(<AIMarkdown content={ORPHAN} preserveOrphanReferences />);
    expect(footers(container)).toHaveLength(1);
    expect(container.textContent).toContain('Orphan note');

    await render(<AIMarkdown content={ORPHAN} preserveOrphanReferences={false} />);
    expect(footers(container)).toHaveLength(0);
    expect(container.textContent).not.toContain('Orphan note');

    await render(<AIMarkdown content={ORPHAN} preserveOrphanReferences />);
    expect(footers(container)).toHaveLength(1);
    expect(container.textContent).toContain('Orphan note');
  });

  test('coordinated: the aggregate footer follows the wrapper prop without re-parsing the chunk', async () => {
    function Document({ preserve }: { preserve: boolean }) {
      return (
        <AIMarkdownDocuments preserveOrphanReferences={preserve}>
          <AIMarkdown documentId="doc" content={ORPHAN} />
        </AIMarkdownDocuments>
      );
    }
    await render(<Document preserve />);
    expect(footers(container)).toHaveLength(1);
    expect(container.textContent).toContain('Orphan note');
    expect(parseCalls).toHaveLength(1);
    const parsesAfterMount = parseCalls[0];
    expect(parsesAfterMount).toBeGreaterThan(0);

    await render(<Document preserve={false} />);
    expect(footers(container)).toHaveLength(0);
    expect(container.textContent).not.toContain('Orphan note');
    expect(parseCalls[0]).toBe(parsesAfterMount);

    await render(<Document preserve />);
    expect(footers(container)).toHaveLength(1);
    expect(container.textContent).toContain('Orphan note');
    expect(parseCalls[0]).toBe(parsesAfterMount);
  });
});

describe('documentIndex change on a mounted chunk', () => {
  const A = 'Alpha[^a].\n\n[^a]: Note A';
  const B = 'Beta[^b].\n\n[^b]: Note B';

  let registry: Registry | null = null;
  function Probe() {
    // eslint-disable-next-line react-hooks/globals -- test probe capturing the hook's value for assertions after act().
    registry = useDocumentRegistry('doc');
    return null;
  }
  const labelOrder = () =>
    registry!.chunkOrder.map((sym) => Array.from(registry!.chunkData.get(sym)!.ownFootnoteLabels).join(','));

  function Document({ indexOfA }: { indexOfA: number }) {
    return (
      <AIMarkdownDocuments>
        <Probe />
        <div data-chunk="a">
          <AIMarkdown documentId="doc" documentIndex={indexOfA} content={A} />
        </div>
        <div data-chunk="b">
          <AIMarkdown documentId="doc" documentIndex={1} content={B} />
        </div>
      </AIMarkdownDocuments>
    );
  }

  test('moves the chunk in chunkOrder and renumbers the aggregate footer', async () => {
    await render(<Document indexOfA={0} />);
    expect(labelOrder()).toEqual(['A', 'B']);
    expect(marks(container)).toEqual(['1', '2']);
    expect(footerItems(container)).toEqual(['doc-user-content-fn-a', 'doc-user-content-fn-b']);
    expect(container.querySelector('[data-chunk="b"] section[data-footnotes]')).not.toBeNull();

    await render(<Document indexOfA={2} />);
    expect(labelOrder()).toEqual(['B', 'A']);
    // DOM order is still A then B; the numbers now follow document order.
    expect(marks(container)).toEqual(['2', '1']);
    expect(footerItems(container)).toEqual(['doc-user-content-fn-b', 'doc-user-content-fn-a']);
    expect(footers(container)).toHaveLength(1);
    expect(container.querySelector('[data-chunk="a"] section[data-footnotes]')).not.toBeNull();
  });
});
