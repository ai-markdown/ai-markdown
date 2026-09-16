import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';

type ViteConfig = Parameters<NonNullable<StorybookConfig['viteFinal']>>[0];
const sources = {
  '@ai-markdown/engine': 'packages/engine/src/index.ts',
  '@ai-markdown/core': 'packages/core/src/index.ts',
  '@ai-markdown/remark-mark-highlight': 'packages/remark-mark-highlight/src/index.ts',
  '@ai-markdown/code-language-detector': 'packages/code-language-detector/src/index.ts',
  '@ai-markdown/react': 'packages/react/src/index.tsx',
  '@ai-markdown/react/plugins': 'packages/react/src/plugins/index.ts',
  '@ai-markdown/react/typography/default.css': 'packages/react/src/components/typography/variants/default.scss',
  '@ai-markdown/react-mantine': 'packages/react-mantine/src/index.tsx',
  '@ai-markdown/vue': 'packages/vue/src/index.ts',
  '@ai-markdown/vue/styles.css': 'packages/vue/src/styles.css',
};
/** Development resolves one source instance per package; static builds retain exports resolution. */
export function withWorkspaceSources(config: ViteConfig, configType: string): ViteConfig {
  if (configType !== 'DEVELOPMENT') return config;
  const existing = config.resolve?.alias;
  const entries = config.optimizeDeps?.entries;
  const sourcePath = (source: string) => fileURLToPath(new URL(`../../../${source}`, import.meta.url));
  return {
    ...config,
    resolve: {
      ...config.resolve,
      alias: [
        ...Object.entries(sources).map(([name, source]) => ({
          find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
          replacement: sourcePath(source),
        })),
        ...(Array.isArray(existing)
          ? existing
          : Object.entries(existing ?? {}).map(([find, replacement]) => ({ find, replacement }))),
      ],
    },
    optimizeDeps: {
      ...config.optimizeDeps,
      // Scan the newly unbundled shared layers before the first browser request.
      // Otherwise Vitest can reload mid-test as their dependencies are discovered.
      entries: [
        ...(typeof entries === 'string' ? [entries] : (entries ?? [])),
        ...[
          '@ai-markdown/engine',
          '@ai-markdown/core',
          '@ai-markdown/remark-mark-highlight',
          '@ai-markdown/code-language-detector',
        ].map((name) => sourcePath(sources[name as keyof typeof sources])),
      ],
      exclude: [...(config.optimizeDeps?.exclude ?? []), ...Object.keys(sources)],
    },
  };
}
