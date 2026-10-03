import { docsComponents } from '@ai-markdown/storybook-kit/react/docsComponents';
import type { Preview } from '@storybook/vue3-vite';
import { h, onMounted, onUpdated } from 'vue';
import { useGlobals } from 'storybook/preview-api';
import { CATALOG_COLORS, catalogVariables } from '@ai-markdown/storybook-kit/common/catalogTheme';
import { storyPresentation } from '@ai-markdown/storybook-kit/common/storyPresentation';
import '@ai-markdown/storybook-kit/common/preview.css';
// Storybook's docs UI uses React even when the component renderer is Vue.
import { AimDocsContainer } from '@ai-markdown/storybook-kit/react/AimDocsContainer';
import { getUserPreferredColorTheme } from '@ai-markdown/storybook-kit/common/sb-theme';
import '@ai-markdown/vue/styles.css';
import 'katex/dist/katex.min.css';
const preview: Preview = {
  parameters: {
    docs: { container: AimDocsContainer, components: docsComponents },
    a11y: { test: 'todo' },
    options: {
      storySort: {
        // Storybook statically parses this array. Keep both renderer orders aligned.
        order: [
          'Introduction',
          'Playground',
          'Basics',
          ['Markdown Basics', 'Math', 'CJK & International Text', 'Footnotes & Definition Lists', 'Engine Plugins'],
          'Customization',
          [
            'Custom Components',
            'Metadata',
            'URL Sanitization',
            'Content Preprocessors',
            'Orphan References',
            'Theming',
            'Extending',
          ],
          'Streaming',
          [
            'Streaming Basics',
            'Incremental Parsing',
            'Smooth Streaming',
            'Streaming Cursor',
            'Turn Taking',
            'Error Recovery',
          ],
          'Documents',
          ['Cross-Chunk Coordination', 'Definition Lifecycle'],
          'Integrations',
          ['Mantine'],
          'Performance Lab',
          ['About', '*'],
          'QA',
        ],
      },
    },
  },
  initialGlobals: { theme: getUserPreferredColorTheme(), autoStart: 'off' },
  globalTypes: {
    theme: {
      description: 'Preview color scheme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (story, context) => {
      // Storybook's preview hook keeps embedded docs examples in sync too.
      const [globals] = useGlobals();
      const presentation = storyPresentation(context.title, context.name, context.viewMode, context.parameters.layout);
      return {
        setup() {
          const scheme = () => (globals.theme === 'dark' ? ('dark' as const) : ('light' as const));
          const syncCanvas = () => {
            if (context.viewMode !== 'story') return;
            document.body.style.backgroundColor = CATALOG_COLORS[scheme()].surface;
            document.body.style.colorScheme = scheme();
          };
          onMounted(syncCanvas);
          onUpdated(syncCanvas);
          return () =>
            h(
              'div',
              {
                class: presentation.bare ? undefined : 'aim-story',
                'data-embedded': context.viewMode === 'docs',
                style: { ...catalogVariables(scheme()), colorScheme: scheme(), color: CATALOG_COLORS[scheme()].text },
              },
              presentation.bare
                ? [h(story())]
                : [
                    presentation.heading
                      ? h('header', { class: 'aim-story-header' }, [
                          h('p', { class: 'aim-story-breadcrumb' }, presentation.breadcrumb),
                          h('p', { class: 'aim-story-title' }, presentation.name),
                        ])
                      : null,
                    h('div', { class: 'aim-story-body' }, [h(story())]),
                  ]
            );
        },
      };
    },
  ],
};
export default preview;
