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
  defaultCodeBlockLabels,
  extractCode,
  normalizeRenderers,
  resolveLabels,
  type CodeRendererInput,
  type CodeBlockOptions,
} from '@ai-markdown/core/components';
import { resolveCodeHighlightLanguage, resolveCodeBlockPolicy } from '@ai-markdown/core/components';
import { useCodeHighlight } from './useCodeHighlight';
export { useCodeHighlight } from './useCodeHighlight';
import { useCodeBlock } from './useCodeBlock';

// The Mantine code block is built on the same hook.
export { useCodeBlock } from './useCodeBlock';
export type { CodeBlockInput, CodeBlockSnapshot, CodeBlockLabels, LabelsOption } from '@ai-markdown/core/components';

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
    const config = resolveCodeBlockPolicy(options, group);
    const parsed = extractCode(node);
    const code = parsed?.code ?? '';
    const language = parsed?.language ?? '';
    const identity = `${document.documentId}:${node?.position?.start.offset ?? ''}:${language}`;
    const block = useCodeBlock({
      code,
      language,
      identity,
      streaming,
      autoDetect: config.autoDetectUnknownLanguage,
      formatJson: config.formatJson,
      expandNestedJson: config.expandNestedJson,
      highlightIntervalMs: config.highlightIntervalMs,
    });
    const { generation, text: displayed, language: detected } = block;
    const mounted = useSyncExternalStore(subscribeClient, clientSnapshot, serverSnapshot);
    const [source, setSource] = useState(false);
    const [expanded, setExpanded] = useState(config.defaultExpanded);
    const [feedback, setFeedback] = useState<'' | 'copied' | 'copyFailed'>('');
    const labels = resolveLabels(defaultCodeBlockLabels, options.labels ?? group?.labels);
    // A rewritten block starts over: React discards this state with an abandoned render.
    const [seen, setSeen] = useState(generation);
    if (generation !== seen) {
      setSeen(generation);
      setSource(false);
      setFeedback('');
    }
    const Renderer = renderers[language];
    const highlighter = options.highlighter ?? group?.highlighter;
    const languageFormat = options.languageFormat ?? group?.languageFormat;
    const highlightState = useCodeHighlight({
      adapter: highlighter,
      streaming,
      code: displayed,
      language: detected,
      colorScheme: colorScheme === 'dark' ? 'dark' : 'light',
      generation,
      active: !(Renderer && mounted && !source),
    });
    const highlighted = useMemo(() => {
      if (Renderer && mounted && !source) return displayed;
      if (highlighter) {
        const result = highlightState.result;
        if (!result) return displayed;
        if ('html' in result) return <span dangerouslySetInnerHTML={{ __html: result.html }} />;
        return result.tokens.map((token, index) => (
          <span
            key={index}
            style={{
              color: token.color,
              backgroundColor: token.backgroundColor,
              fontStyle: (token.fontStyle ?? 0) & 1 ? 'italic' : undefined,
              fontWeight: (token.fontStyle ?? 0) & 2 ? 'bold' : undefined,
              textDecoration: (token.fontStyle ?? 0) & 4 ? 'underline' : undefined,
            }}
          >
            {token.text}
          </span>
        ));
      }
      try {
        return options.highlight?.(displayed, resolveCodeHighlightLanguage(detected, languageFormat)) ?? displayed;
      } catch {
        return displayed;
      }
    }, [displayed, detected, Renderer, mounted, source, highlighter, highlightState.result, languageFormat]);
    if (!parsed) return <pre {...props}>{children}</pre>;
    const original = (
      <pre {...props}>
        <code
          data-highlight-status={highlighter ? highlightState.status : options.highlight ? 'callback' : 'plain'}
          data-highlight-language={highlighter ? highlightState.language : undefined}
          className={language ? `language-${language}` : undefined}
        >
          {highlighted}
        </code>
      </pre>
    );
    const resetKey = `${identity}:${generation}`;
    return (
      <section className="aimd-code" data-language={language} data-color-scheme={colorScheme}>
        <div className="aimd-toolbar" role="group" aria-label={labels.actions}>
          <span>{detected || labels.plainText}</span>
          <button
            type="button"
            onClick={() => {
              const snapshot = code;
              void (async () => {
                try {
                  await navigator.clipboard.writeText(snapshot);
                  setFeedback('copied');
                } catch {
                  setFeedback('copyFailed');
                }
              })();
            }}
          >
            {labels.copy}
          </button>
          {Renderer && (
            <button type="button" aria-pressed={source} onClick={() => setSource((value) => !value)}>
              {source ? labels.showPreview : labels.showSource}
            </button>
          )}
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? labels.collapse : labels.expand}
          </button>
          <span role="status">{feedback && labels[feedback]}</span>
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
                    <p role="alert">{labels.previewFailed}</p>
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

export {
  CodeLanguageFormat,
  resolveCodeHighlightLanguage,
  createPierreHighlightAdapter,
} from '@ai-markdown/core/components';
export type {
  CodeHighlightAdapter,
  CodeHighlightResult,
  CodeHighlightRequest,
  CodeHighlightToken,
  CodeLanguageResolver,
} from '@ai-markdown/core/components';
