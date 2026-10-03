import { h, nextTick, ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import AIMarkdown from '../src';
import { SHOWCASE } from '@ai-markdown/storybook-kit/common/corpus';
const meta: Meta = {
  title: 'Performance Lab/DOM Update',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A local Vue measurement from source assignment through nextTick (DOM commit). It excludes paint, networking and server rendering. Run in the same build mode and environment when comparing samples; this is not a React/Vue ranking or a latency gate. The benchmark starts only on request.',
      },
    },
  },
};
export default meta;
export const CorpusCommit: StoryObj = {
  render: () => ({
    setup() {
      const source = ref('');
      const elapsed = ref<number | null>(null);
      const busy = ref(false);
      const measure = async () => {
        busy.value = true;
        source.value = '';
        await nextTick();
        const start = performance.now();
        source.value = SHOWCASE;
        await nextTick();
        elapsed.value = performance.now() - start;
        busy.value = false;
      };
      return () =>
        h('section', [
          h('button', { disabled: busy.value, onClick: measure }, 'Measure corpus update'),
          h(
            'output',
            { 'data-measurement': elapsed.value === null ? 'idle' : 'complete' },
            elapsed.value === null
              ? 'Not measured'
              : `${elapsed.value.toFixed(2)} ms · ${SHOWCASE.length} source characters · assignment → nextTick`
          ),
          elapsed.value === null
            ? h(
                'p',
                { style: { opacity: 0.75, fontSize: '14px' } },
                'Run the measurement to render the shared corpus and inspect its DOM commit time.'
              )
            : null,
          h(AIMarkdown, { content: source.value }),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    // Keep the public instrument idle. Vitest explicitly exercises its control.
    if (!import.meta.env.VITEST) return;
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Measure corpus update' }));
    await waitFor(() => expect(canvasElement.querySelector('[data-measurement="complete"]')).not.toBeNull());
    expect(canvasElement.querySelector('table')).not.toBeNull();
  },
};
