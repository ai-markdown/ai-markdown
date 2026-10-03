import { ComparisonPanel } from '@ai-markdown/storybook-kit/vue/layouts';
import { LINKS } from '@ai-markdown/storybook-kit/common/corpus';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { defineComponent, h, ref } from 'vue';
import AIMarkdown, { type MarkdownElementContext } from '../../src';
const meta: Meta = {
  title: 'Customization/Metadata',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Compare metadata and streaming state in a mapped component and scoped slot. Both are reactive. Unlike React context hooks, Vue delivers these values directly through component props and scoped-slot arguments.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<{ metadata?: string; streaming?: boolean }>;
const ContextLink = defineComponent({
  inheritAttrs: false,
  props: ['node', 'streaming', 'metadata'],
  setup:
    (props, { attrs, slots }) =>
    () =>
      h(
        'a',
        {
          ...attrs,
          'data-context-owner': 'component',
          'data-node-tag': props.node.tagName,
          'data-streaming': String(props.streaming),
          title: String(props.metadata),
        },
        slots.default?.()
      ),
});
export const ReactiveContext: Story = {
  args: { metadata: 'Corpus links', streaming: true },
  argTypes: { metadata: { control: 'text' }, streaming: { control: 'boolean' } },
  parameters: {
    docs: {
      description: {
        story:
          'The two renderers share the same corpus source and metadata. The first uses a mapped component with inheritAttrs disabled and explicit attribute forwarding. The second forwards slot properties and children. Change metadata or streaming in Controls to inspect both contexts without reparsing new text. Update context temporarily overrides both values; Reset context resumes the current Controls values. The automatic interaction check restores this Controls-driven state before finishing.',
      },
    },
  },
  render: (args) => ({
    setup() {
      const updated = ref(false);
      return () => {
        const metadata = updated.value ? 'Updated context' : args.metadata;
        const streaming = updated.value ? false : args.streaming;
        return h('section', [
          h(
            'button',
            {
              onClick: () => {
                updated.value = !updated.value;
              },
            },
            updated.value ? 'Reset context' : 'Update context'
          ),
          h('div', { class: 'aim-comparison' }, [
            h(
              ComparisonPanel,
              { label: 'Component mapping' },
              { default: () => h(AIMarkdown, { content: LINKS, metadata, streaming, components: { a: ContextLink } }) }
            ),
            h(
              ComparisonPanel,
              { label: 'Scoped slot' },
              {
                default: () =>
                  h(
                    AIMarkdown,
                    { content: LINKS, metadata, streaming },
                    {
                      a: (context: MarkdownElementContext) =>
                        h(
                          'a',
                          {
                            ...context.properties,
                            'data-context-owner': 'slot',
                            'data-node-tag': context.node.tagName,
                            'data-streaming': String(context.streaming),
                            title: String(context.metadata),
                          },
                          context.children
                        ),
                    }
                  ),
              }
            ),
          ]),
        ]);
      };
    },
  }),
  play: async ({ canvasElement }) => {
    for (const owner of ['component', 'slot']) {
      await waitFor(() =>
        expect(canvasElement.querySelector(`[data-context-owner="${owner}"]`)).toHaveAttribute('title', 'Corpus links')
      );
      const link = canvasElement.querySelector(`[data-context-owner="${owner}"]`)!;
      expect(link).toHaveAttribute('data-node-tag', 'a');
      expect(link).toHaveAttribute('data-streaming', 'true');
      expect(link.getAttribute('href')).toBeTruthy();
      expect(link.textContent?.length).toBeGreaterThan(0);
    }
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Update context' }));
    await waitFor(() => {
      for (const owner of ['component', 'slot']) {
        const links = canvasElement.querySelectorAll(`[data-context-owner="${owner}"]`);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
          expect(link).toHaveAttribute('title', 'Updated context');
          expect(link).toHaveAttribute('data-streaming', 'false');
        }
      }
    });
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Reset context' }));
    await waitFor(() => {
      for (const owner of ['component', 'slot']) {
        const link = canvasElement.querySelector(`[data-context-owner="${owner}"]`);
        expect(link).toHaveAttribute('title', 'Corpus links');
        expect(link).toHaveAttribute('data-streaming', 'true');
      }
    });
  },
};
