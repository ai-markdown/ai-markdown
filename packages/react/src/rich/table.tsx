'use client';
import { useMemo, useState, type ComponentProps } from 'react';
import type { Element } from 'hast';
import { projectTable, serializeTable } from '@ai-markdown/core/components';
export type MarkdownTableProps = ComponentProps<'table'> & { node?: Element };
export function MarkdownTable({ node, children, ...props }: MarkdownTableProps) {
  const projection = useMemo(() => projectTable(node), [node]);
  const [feedback, setFeedback] = useState('');
  const copy = async () => {
    if (!projection.rows) return;
    const snapshot = serializeTable(projection.rows, '\t');
    try {
      await navigator.clipboard.writeText(snapshot);
      setFeedback('Table copied');
    } catch {
      setFeedback('Copy failed');
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
    <div className="aimd-table">
      <div className="aimd-toolbar" role="group" aria-label="Table actions">
        <button type="button" disabled={!projection.rows} title={projection.reason} onClick={() => void copy()}>
          Copy table
        </button>
        <button type="button" disabled={!projection.rows} title={projection.reason} onClick={download}>
          Download CSV
        </button>
        <span role="status">{projection.reason || feedback}</span>
      </div>
      <div className="aimd-table-scroll" tabIndex={0} role="region" aria-label="Scrollable table">
        <table {...props}>{children}</table>
      </div>
    </div>
  );
}
