import { SHOWCASE, CODE, DIAGRAMS } from '@ai-markdown/storybook-kit/common/corpus';
export const SCHEME_SAMPLE_DOC = CODE;
export const MERMAID_STATIC_DOC = DIAGRAMS;
export const MANTINE_SHOWCASE = [SHOWCASE, DIAGRAMS].join('\n\n');

// Dedicated collapse, nested JSON and language-detection inputs.
export const LONG_CODE_DOC: string = [
  '# A long code block',
  '',
  'The fence below runs past the collapsed height cap, so the expand control',
  'has something to do.',
  '',
  '```typescript',
  "import { useCallback, useEffect, useRef, useState } from 'react';",
  '',
  'export interface StreamOptions {',
  '  /** Characters emitted per tick. */',
  '  chunkSize: number;',
  '  /** Milliseconds between ticks. */',
  '  interval: number;',
  '}',
  '',
  'const DEFAULTS: StreamOptions = { chunkSize: 4, interval: 24 };',
  '',
  '/** Replay a finished response as if it were still arriving. */',
  'export function useReplay(source: string, options?: Partial<StreamOptions>) {',
  '  const { chunkSize, interval } = { ...DEFAULTS, ...options };',
  "  const [content, setContent] = useState('');",
  '  const [streaming, setStreaming] = useState(false);',
  '  const cursor = useRef(0);',
  '',
  '  const restart = useCallback(() => {',
  '    cursor.current = 0;',
  "    setContent('');",
  '    setStreaming(true);',
  '  }, []);',
  '',
  '  useEffect(() => {',
  '    if (!streaming) return;',
  '    const timer = window.setInterval(() => {',
  '      cursor.current += chunkSize;',
  '      setContent(source.slice(0, cursor.current));',
  '      if (cursor.current >= source.length) {',
  '        window.clearInterval(timer);',
  '        setStreaming(false);',
  '      }',
  '    }, interval);',
  '    return () => window.clearInterval(timer);',
  '  }, [streaming, source, chunkSize, interval]);',
  '',
  '  useEffect(restart, [restart]);',
  '',
  '  return { content, streaming, restart };',
  '}',
  '```',
].join('\n');

export const JSON_PAYLOAD_DOC: string = [
  '# A minified JSON payload',
  '',
  'One line as written, two levels deep once printed:',
  '',
  '```json',
  '{"model":"claude","stream":true,"usage":{"input_tokens":1841,"output_tokens":612},' +
    '"tool_result":"{\\"query\\":\\"weather in Kyoto\\",\\"hits\\":[{\\"title\\":\\"Kyoto forecast\\",' +
    '\\"score\\":0.92},{\\"title\\":\\"Kansai outlook\\",\\"score\\":0.71}]}"}',
  '```',
].join('\n');

/** A block that fits under the collapsed height and one that does not. */
export const EXPAND_COLLAPSE_DOC: string = [
  '# Expand and collapse',
  '',
  'A short block. It fits under the 320px cap, so collapsing it changes nothing:',
  '',
  '```typescript',
  'export function clamp(value: number, min: number, max: number): number {',
  '  return Math.min(max, Math.max(min, value));',
  '}',
  '```',
  '',
  'A long block. Collapsing it cuts it to 320px:',
  '',
  LONG_CODE_DOC.slice(LONG_CODE_DOC.indexOf('```typescript')),
].join('\n');

export const UNLABELED_CODE_DOC: string = [
  '# A fence with no language',
  '',
  '```',
  'def summarize(chunks: list[str]) -> str:',
  '    """Join streamed chunks and trim the trailing partial word."""',
  "    text = ''.join(chunks)",
  "    head, _, tail = text.rpartition(' ')",
  '    return head if tail.endswith(("…", "...")) else text',
  '```',
].join('\n');
