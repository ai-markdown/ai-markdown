'use client';
import { useMemo, type ReactNode } from 'react';
import { CodeHighlightAdapterProvider } from '@mantine/code-highlight';
import { useCodeHighlight } from '@ai-markdown/react/components/code/plain';
import type { CodeHighlightInput } from '@ai-markdown/core/components';
const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
/** Explicit neutral adapter: React owns the block session; this Provider only paints its result. */
export function InjectedCodeHighlight({ input, children }: { input: CodeHighlightInput; children: ReactNode }) {
  const state = useCodeHighlight(input);
  const adapter = useMemo(
    () => ({
      getHighlighter: () => () => {
        const result = state.result;
        const highlightedCode = !result
          ? escape(input.code)
          : 'html' in result
            ? result.html
            : result.tokens
                .map((token) => {
                  const flags = token.fontStyle ?? 0;
                  return `<span style="color:${escape(token.color ?? 'inherit')};background-color:${escape(token.backgroundColor ?? 'transparent')};font-style:${flags & 1 ? 'italic' : 'normal'};font-weight:${flags & 2 ? 'bold' : 'normal'};text-decoration:${flags & 4 ? 'underline' : 'none'}">${escape(token.text)}</span>`;
                })
                .join('');
        return {
          isHighlighted: true,
          highlightedCode,
          codeElementProps: { 'data-highlight-status': state.status, 'data-highlight-language': state.language },
        };
      },
    }),
    [state.result, state.status, state.language, input.code]
  );
  return <CodeHighlightAdapterProvider adapter={adapter}>{children}</CodeHighlightAdapterProvider>;
}
