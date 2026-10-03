import remarkGfm from 'remark-gfm';

/** MDX pages use the same table/task-list syntax as our Markdown examples. */
export const docsAddon = {
  name: '@storybook/addon-docs',
  options: { mdxPluginOptions: { mdxCompileOptions: { remarkPlugins: [remarkGfm] } } },
};
