'use client';
import { extractCode, normalizeRenderers } from '@ai-markdown/core/components';
import {
  createMarkdownCodeBlock as createNeutral,
  type MarkdownCodeBlockOptions,
  type MarkdownCodeBlockProps,
} from '@ai-markdown/react/components/code/plain';
import type { MantineCodeBlockOptions } from '../defs';
import MantineAIMPreCode from '../components/customized/PreCode';
export type { MarkdownCodeBlockProps, CodeRendererInput } from '@ai-markdown/react/components/code/plain';
export interface MantineMarkdownCodeBlockOptions
  extends Omit<MarkdownCodeBlockOptions, 'highlight'>, Partial<MantineCodeBlockOptions> {}
/** Retains the consumer's Mantine highlighter provider and diagram controls.
 * Explicit language extensions use the same source/copy contract as React. */
export function createMarkdownCodeBlock(options: MantineMarkdownCodeBlockOptions = {}) {
  const renderers = normalizeRenderers(options.renderers ?? {});
  const Extension = createNeutral({ ...options, renderers });
  return function MarkdownCodeBlock({ node, children, ...props }: MarkdownCodeBlockProps) {
    const parsed = extractCode(node);
    if (!parsed || !node?.children[0]?.position) return <pre {...props}>{children}</pre>;
    if (renderers[parsed.language])
      return (
        <Extension node={node} {...props}>
          {children}
        </Extension>
      );
    return (
      <MantineAIMPreCode
        key={`pre-code-${node?.position?.start.offset ?? 0}`}
        codeText={parsed.code}
        existLanguage={parsed.language}
        options={options}
        disableSpecial={renderers[parsed.language] === false}
      />
    );
  };
}
export const MarkdownCodeBlock = createMarkdownCodeBlock();
