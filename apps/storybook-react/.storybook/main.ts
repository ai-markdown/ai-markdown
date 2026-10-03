import { docsAddon } from '@ai-markdown/storybook-kit/common/docsAddon';
import { withWorkspaceSources } from '@ai-markdown/storybook-kit/common/workspaceSources';
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  // Stories live in each package's `stories/` directory, never beside the
  // sources. Globbing `src/**` as well matched nothing and made every vitest
  // run print two "No story files found" warnings.
  stories: [
    '../../../packages/react/stories/**/*.mdx',
    '../../../packages/react/stories/**/*.stories.@(ts|tsx)',
    '../../../packages/react-mantine/stories/**/*.mdx',
    '../../../packages/react-mantine/stories/**/*.stories.@(ts|tsx)',
  ],
  addons: ['@storybook/addon-vitest', '@storybook/addon-a11y', docsAddon],
  features: { sidebarOnboardingChecklist: false },
  framework: '@storybook/react-vite',
  // Locally authored placeholders for the story fixtures. Keeping them in-repo
  // is what lets the "zero external requests" rule hold — every image a story
  // renders is served from this directory. The vitest addon reads the same
  // `staticDirs` value, so browser-mode tests serve them too.
  staticDirs: ['../../../tooling/storybook-kit/assets'],
  // The `qa` branch is the play-assertion suite: useful while working on the
  // library, noise for someone reading the published documentation. It stays
  // in the sidebar during development and disappears only from the docs
  // export. This file runs in Node, so the env check works here — and hiding
  // is manager-side, so the stories remain in `index.json` and keep running
  // under vitest either way.
  tags: {
    qa: { excludeFromSidebar: Boolean(process.env.STORYBOOK_DOCS_EXPORT) },
  },
  env: (existing) => ({
    ...existing,
    // Surfaced to the preview as `import.meta.env.STORYBOOK_DOCS_EXPORT`
    // (the Vite builder whitelists the `STORYBOOK_` prefix). Set it to '1'
    // when building the public documentation export: it strips the react-scan
    // instrumentation, which would otherwise ship to visitors and skew the
    // Performance Lab numbers they measure for themselves.
    STORYBOOK_DOCS_EXPORT: process.env.STORYBOOK_DOCS_EXPORT ?? '',
  }),
  viteFinal: (viteConfig, { configType }) =>
    withWorkspaceSources(
      {
        ...viteConfig,
        css: {
          ...viteConfig.css,
          preprocessorOptions: {
            ...viteConfig.css?.preprocessorOptions,
            scss: {
              ...viteConfig.css?.preprocessorOptions?.scss,
              // packages/react-mantine/stories/globals.scss needs `@import` to scope the
              // highlight.js themes per color scheme — `@use` cannot nest inside a
              // selector. Sass 1.80+ warns on every `@import`; the file documents
              // the migration plan for when Sass 3.0 removes it.
              silenceDeprecations: ['import'],
            },
          },
        },
      },
      configType
    ),
};
export default config;
