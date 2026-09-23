import type { DefineComponent } from 'vue';
import type { MarkdownComponentProps } from './types';
import { computed, defineComponent, h, ref, type PropType } from 'vue';
import type { Element } from 'hast';
import { projectTable, serializeTable } from '@ai-markdown/core/components';
export const MarkdownTable = defineComponent({
  name: 'MarkdownTable',
  inheritAttrs: false,
  props: { node: Object as PropType<Element>, streaming: Boolean, metadata: null },
  setup(props, { attrs, slots }) {
    const projection = computed(() => projectTable(props.node)),
      feedback = ref('');
    const copy = async () => {
      if (!projection.value.rows) return;
      const snapshot = serializeTable(projection.value.rows, '\t');
      try {
        await navigator.clipboard.writeText(snapshot);
        feedback.value = 'Table copied';
      } catch {
        feedback.value = 'Copy failed';
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
    return () =>
      h('div', { class: 'aimd-table' }, [
        h('div', { class: 'aimd-toolbar', role: 'group', 'aria-label': 'Table actions' }, [
          h(
            'button',
            { type: 'button', disabled: !projection.value.rows, title: projection.value.reason, onClick: copy },
            'Copy table'
          ),
          h(
            'button',
            { type: 'button', disabled: !projection.value.rows, title: projection.value.reason, onClick: download },
            'Download CSV'
          ),
          h('span', { role: 'status' }, projection.value.reason || feedback.value),
        ]),
        h('div', { class: 'aimd-table-scroll', tabindex: 0, role: 'region', 'aria-label': 'Scrollable table' }, [
          h('table', attrs, slots.default?.()),
        ]),
      ]);
  },
}) as DefineComponent<MarkdownComponentProps>;
