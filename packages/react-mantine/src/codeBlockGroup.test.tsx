/**
 * The mantine `codeBlock` behavior group: flat prop, additive-Provider
 * transport, and the single-assertion narrow hook.
 */
import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import { AIMarkdownBehaviorsProvider } from '@ai-markdown/react';
import MantineAIMarkdown from './MantineAIMarkdown';
import { useMantineCodeBlockOptions } from './hooks/useMantineCodeBlockOptions';
import { defineMantineBehaviors } from './define';

const adapter = createHighlightJsAdapter(hljs);

function renderMarkdown(ui: ReactNode) {
  return renderToString(
    <MantineProvider>
      <CodeHighlightAdapterProvider adapter={adapter}>{ui}</CodeHighlightAdapterProvider>
    </MantineProvider>
  );
}

const CODE_FENCE = '```typescript\nconst answer = 42;\n```';

/** Probe rendered through `em` so it sits inside the provider stack. */
function OptionsProbe() {
  const options = useMantineCodeBlockOptions();
  return (
    <em data-expanded={String(options.defaultExpanded)} data-autodetect={String(options.autoDetectUnknownLanguage)} />
  );
}

describe('codeBlock behavior group', () => {
  test('defaults resolve inside the hook when nothing is passed', () => {
    const html = renderMarkdown(<MantineAIMarkdown content={'*p*'} customComponents={{ em: OptionsProbe }} />);
    expect(html).toContain('data-expanded="true"');
    expect(html).toContain('data-autodetect="true"');
  });

  test('partial codeBlock prop replaces the group; omitted fields fall to defaults', () => {
    const html = renderMarkdown(
      <MantineAIMarkdown
        content={'*p*'}
        codeBlock={{ defaultExpanded: false }}
        customComponents={{ em: OptionsProbe }}
      />
    );
    expect(html).toContain('data-expanded="false"');
    expect(html).toContain('data-autodetect="true"');
  });

  test('defineMantineBehaviors fragment spreads into the component', () => {
    const BEHAVIORS = defineMantineBehaviors({ codeBlock: { defaultExpanded: false }, blockMemo: false });
    const html = renderMarkdown(
      <MantineAIMarkdown content={'*p*'} {...BEHAVIORS} customComponents={{ em: OptionsProbe }} />
    );
    expect(html).toContain('data-expanded="false"');
  });

  test('absent prop contributes NO group — an outer app-level Provider group passes through', () => {
    const html = renderMarkdown(
      <AIMarkdownBehaviorsProvider value={{ codeBlock: { defaultExpanded: false } }}>
        <MantineAIMarkdown content={'*p*'} customComponents={{ em: OptionsProbe }} />
      </AIMarkdownBehaviorsProvider>
    );
    expect(html).toContain('data-expanded="false"');
    expect(html).toContain('data-autodetect="true"');
  });

  test('the codeBlock prop wins over an outer Provider group (inner-wins merge)', () => {
    const html = renderMarkdown(
      <AIMarkdownBehaviorsProvider value={{ codeBlock: { defaultExpanded: false, autoDetectUnknownLanguage: false } }}>
        <MantineAIMarkdown
          content={'*p*'}
          codeBlock={{ defaultExpanded: true }}
          customComponents={{ em: OptionsProbe }}
        />
      </AIMarkdownBehaviorsProvider>
    );
    // Group replacement is atomic: the outer group's autoDetect does NOT
    // merge into the winning inner group — omitted fields fall to defaults.
    expect(html).toContain('data-expanded="true"');
    expect(html).toContain('data-autodetect="true"');
  });

  test('the prop and an equivalent define fragment render identical bytes; the toggle takes effect', () => {
    const viaProp = renderMarkdown(
      <MantineAIMarkdown content={CODE_FENCE} documentId="beq" codeBlock={{ defaultExpanded: false }} />
    );
    const FRAGMENT = defineMantineBehaviors({ codeBlock: { defaultExpanded: false } });
    const viaFragment = renderMarkdown(<MantineAIMarkdown content={CODE_FENCE} documentId="beq" {...FRAGMENT} />);
    expect(viaFragment).toBe(viaProp);
    // Sanity: the toggle actually took effect vs. the default-expanded render.
    const expanded = renderMarkdown(<MantineAIMarkdown content={CODE_FENCE} documentId="beq" />);
    expect(viaProp).not.toBe(expanded);
  });
});
