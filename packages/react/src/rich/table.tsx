'use client';
import { useMemo, useState, type ComponentProps } from 'react';
import type { Element } from 'hast';
import { useAIMarkdownTheme } from '@ai-markdown/react';
import {
  defaultTableLabels,
  projectTable,
  resolveLabels,
  serializeTable,
  type LabelsOption,
  type TableLabels,
} from '@ai-markdown/core/components';
export type { TableLabels, LabelsOption } from '@ai-markdown/core/components';
export type MarkdownTableProps = ComponentProps<'table'> & { node?: Element };
export interface MarkdownTableOptions {
  /** Text of the toolbar, as overrides of the English defaults. A function is called at a fixed place in every render, so it may call hooks. */
  labels?: LabelsOption<TableLabels>;
}
/** Create once, outside render. */
export function createMarkdownTable(options: MarkdownTableOptions = {}) {
  return function MarkdownTable({ node, children, ...props }: MarkdownTableProps) {
    const { colorScheme } = useAIMarkdownTheme();
    const projection = useMemo(() => projectTable(node), [node]);
    const [feedback, setFeedback] = useState<'' | 'copied' | 'copyFailed'>('');
    const labels = resolveLabels(defaultTableLabels, options.labels);
    const refusal = projection.reason && labels[projection.reason];
    const copy = async () => {
      if (!projection.rows) return;
      const snapshot = serializeTable(projection.rows, '\t');
      try {
        await navigator.clipboard.writeText(snapshot);
        setFeedback('copied');
      } catch {
        setFeedback('copyFailed');
      }
    };
    const download = () => {
      if (!projection.rows) return;
      const snapshot = serializeTable(projection.rows);
      const url = URL.createObjectURL(new Blob(['\uFEFF', snapshot], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'table.csv';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    return (
      <div className="aimd-table" data-color-scheme={colorScheme}>
        <div className="aimd-toolbar" role="group" aria-label={labels.actions}>
          <button type="button" disabled={!projection.rows} title={refusal} onClick={() => void copy()}>
            {labels.copy}
          </button>
          <button type="button" disabled={!projection.rows} title={refusal} onClick={download}>
            {labels.download}
          </button>
          <span role="status">{refusal || (feedback && labels[feedback])}</span>
        </div>
        <div className="aimd-table-scroll" tabIndex={0} role="region" aria-label={labels.scrollRegion}>
          <table {...props}>{children}</table>
        </div>
      </div>
    );
  };
}
export const MarkdownTable = createMarkdownTable();
