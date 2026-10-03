import { EMPHASIS, LINKS, QUOTES } from '@ai-markdown/storybook-kit/common/corpus';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { defineComponent, h, ref } from 'vue';
import AIMarkdown, { type MarkdownElementContext } from '../../src';
const meta: Meta = {
  title: 'Customization/Custom Components',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Map tags to Vue components or provide named element slots. Forward sanitized attributes and rendered children deliberately. A named element slot takes precedence over a mapping for the same tag; removing it restores the mapping.',
      },
    },
  },
};
export default meta;
type Story = StoryObj;
const Quote = defineComponent({
  inheritAttrs: false,
  setup:
    (_, { slots }) =>
    () =>
      h(
        'blockquote',
        { 'data-component': 'quote', style: { borderInlineStart: '4px solid #1971c2', paddingInlineStart: '16px' } },
        slots.default?.()
      ),
});
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
export const ScopedSlots: Story = {
  render: () => ({
    setup: () => () =>
      h(
        AIMarkdown,
        { content: EMPHASIS, metadata: 'Corpus emphasis' },
        {
          strong: ({ children, metadata }: MarkdownElementContext) =>
            h(
              'strong',
              { 'data-slot': 'strong', title: String(metadata), style: { color: 'light-dark(#9c36b5, #e599f7)' } },
              children
            ),
        }
      ),
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-slot="strong"]')).toHaveAttribute('title', 'Corpus emphasis')
    );
  },
};
export const ComponentMapping: Story = {
  render: () => ({ setup: () => () => h(AIMarkdown, { content: QUOTES, components: { blockquote: Quote } }) }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-component="quote"]')).not.toBeNull());
  },
};
export const ReactiveContent: Story = {
  render: () => ({
    setup() {
      const source = ref(EMPHASIS);
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                source.value = QUOTES;
              },
            },
            'Replace source'
          ),
          h(AIMarkdown, { content: source.value }),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Replace source' }));
    await waitFor(() => expect(canvasElement.querySelector('blockquote')).not.toBeNull());
    expect(canvasElement.textContent).not.toContain('inline-emphasis');
  },
};
export const SlotPrecedence: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'With both components.a and an a slot present, the slot renders the link. Remove the slot to fall back to the mapped component, then restore it. Keep forwarding properties and children so hrefs and link labels survive either route.',
      },
    },
  },
  render: () => ({
    setup() {
      const slotEnabled = ref(true);
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                slotEnabled.value = !slotEnabled.value;
              },
            },
            slotEnabled.value ? 'Remove link slot' : 'Restore link slot'
          ),
          h(
            AIMarkdown,
            {
              content: LINKS.replace('[](https://example.test/c)', '[Example C](https://example.test/c)'),
              components: { a: ContextLink },
            },
            slotEnabled.value
              ? {
                  a: ({ properties, children }: MarkdownElementContext) =>
                    h('a', { ...properties, 'data-context-owner': 'slot' }, children),
                }
              : {}
          ),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('[data-context-owner="slot"]')).not.toBeNull());
    expect(canvasElement.querySelector('[data-context-owner="component"]')).toBeNull();
    const href = canvasElement.querySelector('[data-context-owner="slot"]')!.getAttribute('href');
    await userEvent.click(canvas.getByRole('button', { name: 'Remove link slot' }));
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-context-owner="component"]')).toHaveAttribute('href', href)
    );
    expect(canvasElement.querySelector('[data-context-owner="slot"]')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Restore link slot' }));
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-context-owner="slot"]')).toHaveAttribute('href', href)
    );
    expect(canvasElement.querySelector('[data-context-owner="component"]')).toBeNull();
  },
};
