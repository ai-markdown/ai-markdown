import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import rehypeRaw from 'rehype-raw';
import starlight from '@astrojs/starlight';
import { env } from 'node:process';
import { locales } from './src/i18n/config.mjs';
import { contentIntegration } from './scripts/content.mjs';
import { sidebar } from './scripts/navigation.mjs';
import { normalizeBase, repositoryLinks } from './scripts/links.mjs';

const base = normalizeBase(env.DOCS_BASE);
export default defineConfig({
  site: env.DOCS_SITE_URL,
  base,
  trailingSlash: 'always',
  integrations: [
    contentIntegration(),
    starlight({
      title: 'AI Markdown',
      favicon: '/brand/organization-mark.png',
      defaultLocale: 'root',
      locales,
      components: {
        Header: './src/components/Header.astro',
        Head: './src/components/Head.astro',
        Hero: './src/components/Hero.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        LanguageSelect: './src/components/LanguageSelect.astro',
      },
      description: 'Markdown rendering for React and Vue: installation, streaming, customization and adapter APIs.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ai-markdown/ai-markdown' }],
      customCss: ['./src/styles/custom.css'],
      sidebar,
    }),
  ],
  markdown: {
    processor: unified({ rehypePlugins: [rehypeRaw, [repositoryLinks, { base, storybook: env.DOCS_STORYBOOK_URL }]] }),
  },
});
