import { ComparisonPanel } from '@ai-markdown/storybook-kit/vue/layouts';
import { LINKS } from '@ai-markdown/storybook-kit/common/corpus';
import { URL_SCHEMES_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor } from 'storybook/test';
import { h } from 'vue';
import AIMarkdown, { defaultUrlTransform, extendSanitizeSchema, type UrlTransform } from '../../src';
const meta: Meta = {
  title: 'Customization/URL Sanitization',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Default URL policy blocks dangerous schemes before custom rendering. A custom urlTransform can further restrict links. These examples reuse React policy fixtures and corpus links; sanitizer policy is distinct from UI styling.',
      },
    },
  },
};
export default meta;
type Story = StoryObj;
export const LinkPolicy: Story = {
  render: () => ({
    setup: () => () =>
      h(AIMarkdown, {
        content: LINKS.replace('[](https://example.test/c)', '[Example C](https://example.test/c)'),
        urlTransform: (url) => (url.startsWith('https:') ? url : undefined),
      }),
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('a[href]')).not.toBeNull());
    for (const a of canvasElement.querySelectorAll('a[href]')) expect(a.getAttribute('href')).toMatch(/^https:/);
  },
};
export const UnsafeURLs: Story = {
  render: () => ({ setup: () => () => h(AIMarkdown, { content: URL_SCHEMES_DOC }) }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('p')).not.toBeNull());
    for (const a of canvasElement.querySelectorAll('[href], [src]'))
      expect(a.getAttribute('href') ?? a.getAttribute('src')).not.toMatch(/^(javascript|vbscript):/i);
  },
};

const allowAppUrl: UrlTransform = (url, key, node) => (/^app:/i.test(url) ? url : defaultUrlTransform(url, key, node));
const appSchema = extendSanitizeSchema((schema) => {
  schema.protocols!.href!.push('app');
  schema.protocols!.src!.push('app');
});
export const AllowCustomScheme: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The same two-gate example as React. urlTransform alone cannot restore a URL removed by the sanitizer. The second panel also extends protocols.href/src with app; myapp and dangerous schemes remain blocked. The schema and transform are stable module-level values. Links are inspected without opening a custom application.',
      },
    },
  },
  render: () => ({
    setup: () => () =>
      h('div', { class: 'aim-comparison' }, [
        h(
          ComparisonPanel,
          { label: 'URL transform only' },
          {
            default: () =>
              h(AIMarkdown, { content: URL_SCHEMES_DOC, urlTransform: allowAppUrl, 'data-url-policy': 'transform' }),
          }
        ),
        h(
          ComparisonPanel,
          { label: 'URL transform and schema' },
          {
            default: () =>
              h(AIMarkdown, {
                content: URL_SCHEMES_DOC,
                urlTransform: allowAppUrl,
                sanitizeSchema: appSchema,
                'data-url-policy': 'both',
              }),
          }
        ),
      ]),
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-url-policy="both"] a[href^="app:"]')).not.toBeNull());
    expect(canvasElement.querySelector('[data-url-policy="transform"] a[href^="app:"]')).toBeNull();
    expect(canvasElement.querySelector('a[href^="myapp:"]')).toBeNull();
    for (const node of canvasElement.querySelectorAll('[href], [src]'))
      expect(node.getAttribute('href') ?? node.getAttribute('src')).not.toMatch(/^(javascript|vbscript):/i);
  },
};
