'use client';
import {
  Component,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ComponentProps,
  type ReactNode,
} from 'react';
import type { Element } from 'hast';
import {
  useAIMarkdownState,
  useAIMarkdownTheme,
  useAIMarkdownBehaviors,
  useAIMarkdownDocument,
} from '@ai-markdown/react';
import {
  extendsCode,
  extractCode,
  normalizeRenderers,
  prettyPrintJson,
  createJsonCompletenessScanner,
  type CodeRendererInput,
  type CodeBlockOptions,
} from '@ai-markdown/core/components';
import { normalizeHighlightJsLanguage } from '@ai-markdown/code-language-detector';
import { useCodeFrame } from './useCodeFrame';
import { useDetectedLanguage } from './useDetectedLanguage';

// The Mantine code block is built on the same two hooks.
export { useCodeFrame } from './useCodeFrame';
export { useDetectedLanguage } from './useDetectedLanguage';

export type { CodeRendererInput, CodeBlockOptions } from '@ai-markdown/core/components';
export interface MarkdownCodeBlockOptions extends CodeBlockOptions {
  renderers?: Readonly<Record<string, ComponentType<CodeRendererInput> | false>>;
  /** Optional synchronous presentation of code. Return React nodes, not HTML. */
  highlight?: (code: string, language: string) => ReactNode;
}
export type MarkdownCodeBlockProps = ComponentProps<'pre'> & { node?: Element };
class RendererBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
const interval = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
const subscribeClient = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
/** Create once, outside render. Each returned component has isolated options. */
export function createMarkdownCodeBlock(options: MarkdownCodeBlockOptions = {}) {
  const renderers = normalizeRenderers(options.renderers ?? {});
  function MarkdownCodeBlock({ node, children, ...props }: MarkdownCodeBlockProps) {
    const { streaming } = useAIMarkdownState();
    const { colorScheme } = useAIMarkdownTheme();
    const document = useAIMarkdownDocument();
    const group = useAIMarkdownBehaviors().codeBlock as CodeBlockOptions | undefined;
    const option = <K extends keyof CodeBlockOptions>(key: K, fallback: NonNullable<CodeBlockOptions[K]>) =>
      options[key] ?? group?.[key] ?? fallback;
    const parsed = extractCode(node);
    const code = parsed?.code ?? '';
    const language = parsed?.language ?? '';
    const identity = `${document.documentId}:${node?.position?.start.offset ?? ''}:${language}`;
    // React discards this state with an abandoned render. A non-append source
    // gets a fresh renderer generation; append preserves the mounted renderer.
    const [previous, setPrevious] = useState({ code, identity, generation: 0 });
    const generation =
      previous.generation + (identity !== previous.identity || !extendsCode(code, previous.code) ? 1 : 0);
    const mounted = useSyncExternalStore(subscribeClient, clientSnapshot, serverSnapshot);
    const [source, setSource] = useState(false);
    const [expanded, setExpanded] = useState(option('defaultExpanded', true));
    const [feedback, setFeedback] = useState('');
    if (code !== previous.code || identity !== previous.identity) {
      setPrevious({ code, identity, generation });
      if (generation !== previous.generation) {
        setSource(false);
        setFeedback('');
      }
    }
    const frame = useCodeFrame(code, language, streaming, interval(option('highlightIntervalMs', 50), 50));
    const autoDetect = option('autoDetectUnknownLanguage', true);
    const detected = useDetectedLanguage(code, autoDetect && !language, streaming) ?? language;
    const format = option('formatJson', false),
      nested = option('expandNestedJson', false);
    // One scanner per block: a growing JSON block is scanned once, not once per frame.
    const [scanJson] = useState(createJsonCompletenessScanner);
    const jsonComplete = useMemo(
      () => (format && detected === 'json' && streaming ? scanJson(frame) : false),
      [format, detected, streaming, scanJson, frame]
    );
    const displayed = useMemo(
      () => (format && detected === 'json' && (!streaming || jsonComplete) ? prettyPrintJson(frame, nested) : frame),
      [frame, detected, format, nested, streaming, jsonComplete]
    );
    const Renderer = renderers[language];
    const highlighted = useMemo(() => {
      if (Renderer && mounted && !source) return displayed;
      try {
        return options.highlight?.(displayed, normalizeHighlightJsLanguage(detected)) ?? displayed;
      } catch {
        return displayed;
      }
    }, [displayed, detected, Renderer, mounted, source]);
    if (!parsed) return <pre {...props}>{children}</pre>;
    const original = (
      <pre {...props}>
        <code className={language ? `language-${language}` : undefined}>{highlighted}</code>
      </pre>
    );
    const resetKey = `${identity}:${generation}`;
    return (
      <section className="aimd-code" data-language={language} data-color-scheme={colorScheme}>
        <div className="aimd-toolbar" role="group" aria-label="Code block actions">
          <span>{detected || 'text'}</span>
          <button
            type="button"
            onClick={() => {
              const snapshot = code;
              void (async () => {
                try {
                  await navigator.clipboard.writeText(snapshot);
                  setFeedback('Copied');
                } catch {
                  setFeedback('Copy failed');
                }
              })();
            }}
          >
            Copy code
          </button>
          {Renderer && (
            <button type="button" aria-pressed={source} onClick={() => setSource((value) => !value)}>
              {source ? 'Show preview' : 'Show source'}
            </button>
          )}
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          <span role="status">{feedback}</span>
        </div>
        <div
          className="aimd-code-content"
          data-collapsed={!expanded}
          style={!expanded ? { maxHeight: 320, overflow: 'auto' } : undefined}
        >
          {(!mounted || source || !Renderer) && original}
          {mounted && Renderer && (
            <div hidden={source}>
              <RendererBoundary
                key={resetKey}
                fallback={
                  <>
                    <p role="alert">Preview failed. Source is available below.</p>
                    {original}
                  </>
                }
              >
                <Renderer
                  code={code}
                  language={language}
                  streaming={streaming}
                  colorScheme={colorScheme === 'dark' ? 'dark' : 'light'}
                  active={!source && expanded}
                  resetKey={resetKey}
                />
              </RendererBoundary>
            </div>
          )}
        </div>
      </section>
    );
  }
  return MarkdownCodeBlock;
}
export const MarkdownCodeBlock = createMarkdownCodeBlock();
