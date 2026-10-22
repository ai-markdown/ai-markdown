import { resolveCodeHighlightInterval } from './codeHighlight';
import type { CodeBlockLabels, LabelsOption } from './labels';
export interface CodeBlockOptions {
  /** Legacy callbacks default to highlight.js names. Adapters own their language format. */
  languageFormat?: import('./codeHighlight').CodeLanguageResolver;
  /** Takes precedence over the legacy framework highlight callback. */
  highlighter?: import('./codeHighlight').CodeHighlightAdapter;
  defaultExpanded?: boolean;
  autoDetectUnknownLanguage?: boolean;
  formatJson?: boolean;
  expandNestedJson?: boolean;
  highlightIntervalMs?: number;
  mermaidIntervalMs?: number;
  /** Text of the code block, as overrides of the English defaults. A function is called on every render. */
  labels?: LabelsOption<CodeBlockLabels>;
}

/** Common behavior defaults. UI integrations may override these defaults, not their resolution rules. */
export type CodeBlockPolicy = Required<
  Pick<
    CodeBlockOptions,
    'defaultExpanded' | 'autoDetectUnknownLanguage' | 'formatJson' | 'expandNestedJson' | 'highlightIntervalMs'
  >
>;
export const defaultCodeBlockPolicy: Readonly<CodeBlockPolicy> = Object.freeze({
  defaultExpanded: true,
  autoDetectUnknownLanguage: true,
  formatJson: false,
  expandNestedJson: false,
  highlightIntervalMs: 50,
});
export function resolveCodeBlockPolicy(
  overrides?: Partial<CodeBlockPolicy>,
  inherited?: Partial<CodeBlockPolicy>,
  defaults: Partial<CodeBlockPolicy> = defaultCodeBlockPolicy
): CodeBlockPolicy {
  const value = <K extends keyof CodeBlockPolicy>(key: K): CodeBlockPolicy[K] =>
    overrides?.[key] ?? inherited?.[key] ?? defaults[key] ?? defaultCodeBlockPolicy[key];
  return {
    defaultExpanded: value('defaultExpanded'),
    autoDetectUnknownLanguage: value('autoDetectUnknownLanguage'),
    formatJson: value('formatJson'),
    expandNestedJson: value('expandNestedJson'),
    highlightIntervalMs: resolveCodeHighlightInterval(value('highlightIntervalMs'), defaults.highlightIntervalMs ?? 50),
  };
}
