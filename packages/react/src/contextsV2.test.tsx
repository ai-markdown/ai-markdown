/**
 * M2 acceptance (EXECUTION-PLAN §5.2): narrow-hook payloads correct
 * field-by-field (including frozen-ness); legacy and new context layers
 * agree on every shared field; additive Provider transport with the
 * triple core-key lock.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import AIMarkdown from '.';
import {
  useAIMarkdownDocument,
  useAIMarkdownTheme,
  useAIMarkdownState,
  useAIMarkdownBehaviors,
  useAIMarkdown,
  AIMarkdownBehaviorsProvider,
  AIMarkdownStateProvider,
} from './context';

afterEach(() => {
  vi.restoreAllMocks();
});

type AIMarkdownPropsLoose = Partial<Parameters<typeof AIMarkdown>[0]>;

/** Render `<AIMarkdown>` with a Typography-slot probe and capture a hook's value. */
function renderWithProbe<T>(
  useHook: () => T,
  props: AIMarkdownPropsLoose = {},
  wrap: (el: ReactElement) => ReactElement = (el) => el
): T {
  let captured: { value: T } | null = null;
  const Probe = () => {
    // Test-only probe: identity/frozen-ness assertions need the object itself.
    // eslint-disable-next-line react-hooks/globals
    captured = { value: useHook() };
    return null;
  };
  renderToString(wrap(<AIMarkdown content="hello" {...props} Typography={Probe as never} />));
  if (captured === null) throw new Error('probe never rendered');
  return (captured as { value: T }).value;
}

describe('narrow hooks — payloads field-by-field', () => {
  test('useAIMarkdownDocument with explicit id', () => {
    const doc = renderWithProbe(useAIMarkdownDocument, { documentId: 'doc-1' });
    expect(doc).toEqual({ documentId: 'doc-1', documentIdExplicit: true, clobberPrefix: 'doc-1-user-content-' });
    expect(Object.isFrozen(doc)).toBe(true);
  });

  test('useAIMarkdownDocument with auto id', () => {
    const doc = renderWithProbe(useAIMarkdownDocument);
    expect(doc.documentIdExplicit).toBe(false);
    expect(doc.documentId.length).toBeGreaterThan(0);
    expect(doc.clobberPrefix.endsWith('-user-content-')).toBe(true);
  });

  test('useAIMarkdownTheme resolves values and normalizes fontSize', () => {
    const theme = renderWithProbe(useAIMarkdownTheme, { fontSize: 14, colorScheme: 'dark' });
    expect(theme).toEqual({ fontSize: '14px', variant: 'default', colorScheme: 'dark' });
    expect(Object.isFrozen(theme)).toBe(true);
  });

  test('useAIMarkdownState carries streaming', () => {
    expect(renderWithProbe(useAIMarkdownState, { streaming: true })).toEqual({ streaming: true });
    const idle = renderWithProbe(useAIMarkdownState);
    expect(idle.streaming).toBe(false);
    expect(Object.isFrozen(idle)).toBe(true);
  });

  test('useAIMarkdownBehaviors defaults to the three shipped switches', () => {
    const behaviors = renderWithProbe(useAIMarkdownBehaviors);
    expect(behaviors).toEqual({ blockMemo: true, incrementalParse: true, preserveOrphanReferences: true });
    expect(Object.isFrozen(behaviors)).toBe(true);
  });

  test('useAIMarkdownBehaviors reflects flat props', () => {
    const behaviors = renderWithProbe(useAIMarkdownBehaviors, { blockMemo: false, incrementalParse: false });
    expect(behaviors.blockMemo).toBe(false);
    expect(behaviors.incrementalParse).toBe(false);
    expect(behaviors.preserveOrphanReferences).toBe(true);
  });

  test('every narrow hook throws outside <AIMarkdown>', () => {
    for (const [hook, name] of [
      [useAIMarkdownDocument, 'useAIMarkdownDocument'],
      [useAIMarkdownTheme, 'useAIMarkdownTheme'],
      [useAIMarkdownState, 'useAIMarkdownState'],
      [useAIMarkdownBehaviors, 'useAIMarkdownBehaviors'],
    ] as const) {
      const Bare = () => {
        hook();
        return null;
      };
      expect(() => renderToString(<Bare />), name).toThrow(`${name} must be used within`);
    }
  });
});

describe('additive Providers — extension-group transport', () => {
  const CODE_BLOCK = { defaultExpanded: true };

  test('a group stacked outside <AIMarkdown> is visible through useAIMarkdownBehaviors', () => {
    const behaviors = renderWithProbe(useAIMarkdownBehaviors, {}, (el) => (
      <AIMarkdownBehaviorsProvider value={{ codeBlock: CODE_BLOCK }}>{el}</AIMarkdownBehaviorsProvider>
    ));
    expect(behaviors.codeBlock).toBe(CODE_BLOCK);
    expect(behaviors.blockMemo).toBe(true);
    expect(Object.isFrozen(behaviors)).toBe(true);
  });

  test('multi-level stacking: inner wins for a duplicated group key, distinct keys merge', () => {
    const inner = { defaultExpanded: false };
    const other = { lazyRender: true };
    const behaviors = renderWithProbe(useAIMarkdownBehaviors, {}, (el) => (
      <AIMarkdownBehaviorsProvider value={{ codeBlock: CODE_BLOCK, mermaid: other }}>
        <AIMarkdownBehaviorsProvider value={{ codeBlock: inner }}>{el}</AIMarkdownBehaviorsProvider>
      </AIMarkdownBehaviorsProvider>
    ));
    expect(behaviors.codeBlock).toBe(inner);
    expect(behaviors.mermaid).toBe(other);
  });

  test('runtime core-key lock: a forged core key is overwritten by the resolved value, with a dev warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const behaviors = renderWithProbe(useAIMarkdownBehaviors, { blockMemo: true }, (el) => (
      <AIMarkdownBehaviorsProvider value={{ blockMemo: false } as never}>{el}</AIMarkdownBehaviorsProvider>
    ));
    expect(behaviors.blockMemo).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('core key');
  });

  test('narrow hooks still throw under a stacked Provider OUTSIDE <AIMarkdown> (guard is core-key presence, not non-null)', () => {
    const BareState = () => {
      useAIMarkdownState();
      return null;
    };
    expect(() =>
      renderToString(
        <AIMarkdownStateProvider value={{ toolCall: { inProgress: true } }}>
          <BareState />
        </AIMarkdownStateProvider>
      )
    ).toThrow('useAIMarkdownState must be used within');
    const BareBehaviors = () => {
      useAIMarkdownBehaviors();
      return null;
    };
    expect(() =>
      renderToString(
        <AIMarkdownBehaviorsProvider value={{ codeBlock: CODE_BLOCK }}>
          <BareBehaviors />
        </AIMarkdownBehaviorsProvider>
      )
    ).toThrow('useAIMarkdownBehaviors must be used within');
  });

  test('a forged core key in a Provider stacked OUTSIDE <AIMarkdown> satisfies the guard, with the dev warning', () => {
    // Pinned as the current behaviour: the guard reads core-key presence,
    // and only <AIMarkdown>'s CoreProvider overwrites a forged key (runtime
    // lock #2). Outside the tree nothing overwrites it, so the hook returns
    // the forged value instead of throwing. The type lock (#1) forbids the
    // key and the dev warning (#3) reports it; a stricter runtime guard
    // would need a marker only CoreProvider can set.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let state: ReturnType<typeof useAIMarkdownState> | null = null;
    const BareState = () => {
      // eslint-disable-next-line react-hooks/globals
      state = useAIMarkdownState();
      return null;
    };
    expect(() =>
      renderToString(
        <AIMarkdownStateProvider value={{ streaming: true } as never}>
          <BareState />
        </AIMarkdownStateProvider>
      )
    ).not.toThrow();
    expect(state).toEqual({ streaming: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('core key `streaming`');
    let behaviors: ReturnType<typeof useAIMarkdownBehaviors> | null = null;
    const BareBehaviors = () => {
      // eslint-disable-next-line react-hooks/globals
      behaviors = useAIMarkdownBehaviors();
      return null;
    };
    expect(() =>
      renderToString(
        <AIMarkdownBehaviorsProvider value={{ blockMemo: false, codeBlock: CODE_BLOCK } as never}>
          <BareBehaviors />
        </AIMarkdownBehaviorsProvider>
      )
    ).not.toThrow();
    expect(behaviors).toEqual({ blockMemo: false, codeBlock: CODE_BLOCK });
    expect(warn).toHaveBeenCalledTimes(2);
    // Under <AIMarkdown> the same forged value is overwritten (the test above).
  });

  test('type-level core-key lock', () => {
    // @ts-expect-error — `blockMemo` is a locked core key of the behaviors context.
    <AIMarkdownBehaviorsProvider value={{ blockMemo: { on: true } }}>x</AIMarkdownBehaviorsProvider>;
    // @ts-expect-error — `streaming` is the locked core key of the state context.
    <AIMarkdownStateProvider value={{ streaming: { on: true } }}>x</AIMarkdownStateProvider>;
  });

  test('state groups travel through AIMarkdownStateProvider; streaming stays core-resolved', () => {
    const toolCall = { inProgress: true };
    const state = renderWithProbe(useAIMarkdownState, { streaming: true }, (el) => (
      <AIMarkdownStateProvider value={{ toolCall }}>{el}</AIMarkdownStateProvider>
    ));
    expect(state.toolCall).toBe(toolCall);
    expect(state.streaming).toBe(true);
  });
});

describe('useAIMarkdown aggregate', () => {
  test('returns the five subsystem payloads, identical to the narrow hooks', () => {
    const both = renderWithProbe(
      () => ({ aggregate: useAIMarkdown(), document: useAIMarkdownDocument(), theme: useAIMarkdownTheme() }),
      { metadata: { sessionId: 's1' }, documentId: 'agg' }
    );
    expect(both.aggregate.document).toBe(both.document);
    expect(both.aggregate.theme).toBe(both.theme);
    expect(both.aggregate.metadata).toEqual({ sessionId: 's1' });
    expect(both.aggregate.state.streaming).toBe(false);
    expect(both.aggregate.behaviors.blockMemo).toBe(true);
  });
});
