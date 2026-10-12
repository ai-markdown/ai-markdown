import type { DefineComponent } from 'vue';
import type { MarkdownComponentProps } from './types';
import { computed, defineComponent, h, ref, type PropType } from 'vue';
import type { Element } from 'hast';
import {
  defaultTableLabels,
  projectTable,
  resolveLabels,
  serializeTable,
  type LabelsOption,
  type TableLabels,
} from '@ai-markdown/core/components';
export type { TableLabels, LabelsOption } from '@ai-markdown/core/components';
export interface MarkdownTableOptions {
  /** Text of the toolbar, as overrides of the English defaults. A function is read on every render. */
  labels?: LabelsOption<TableLabels>;
}
/** Configure once, then register the result directly as components.table. */
export function createMarkdownTable(options: MarkdownTableOptions = {}): DefineComponent<MarkdownComponentProps> {
  return defineComponent({
    name: 'MarkdownTable',
    inheritAttrs: false,
    props: { node: Object as PropType<Element>, streaming: Boolean, metadata: null },
    setup(props, { attrs, slots }) {
      const projection = computed(() => projectTable(props.node)),
        feedback = ref<'' | 'copied' | 'copyFailed'>('');
      const copy = async () => {
        if (!projection.value.rows) return;
        const snapshot = serializeTable(projection.value.rows, '\t');
        try {
          await navigator.clipboard.writeText(snapshot);
          feedback.value = 'copied';
        } catch {
          feedback.value = 'copyFailed';
        }
      };
      const download = () => {
        if (!projection.value.rows) return;
        const snapshot = serializeTable(projection.value.rows);
        const url = URL.createObjectURL(new Blob(['\uFEFF', snapshot], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'table.csv';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      };
      return () => {
        const labels = resolveLabels(defaultTableLabels, options.labels);
        const refusal = projection.value.reason && labels[projection.value.reason];
        return h('div', { class: 'aimd-table' }, [
          h('div', { class: 'aimd-toolbar', role: 'group', 'aria-label': labels.actions }, [
            h(
              'button',
              { type: 'button', disabled: !projection.value.rows, title: refusal, onClick: copy },
              labels.copy
            ),
            h(
              'button',
              { type: 'button', disabled: !projection.value.rows, title: refusal, onClick: download },
              labels.download
            ),
            h('span', { role: 'status' }, refusal || (feedback.value && labels[feedback.value])),
          ]),
          h('div', { class: 'aimd-table-scroll', tabindex: 0, role: 'region', 'aria-label': labels.scrollRegion }, [
            h('table', attrs, slots.default?.()),
          ]),
        ]);
      };
    },
  }) as DefineComponent<MarkdownComponentProps>;
}
export const MarkdownTable = createMarkdownTable();
