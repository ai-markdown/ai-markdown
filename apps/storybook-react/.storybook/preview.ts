import { waitFor } from 'storybook/test';
import { docsComponents } from '@ai-markdown/storybook-kit/react/docsComponents';
import type { Preview } from '@storybook/react-vite';
import { getUserPreferredColorTheme } from '@ai-markdown/storybook-kit/common/sb-theme';
// React-only decorators are shared with Mantine through the private kit.
import { armReactScan, withReactScan } from '@ai-markdown/storybook-kit/react/reactScan';
import { withColorScheme } from '@ai-markdown/storybook-kit/react/withColorScheme';
import { AimDocsContainer } from '@ai-markdown/storybook-kit/react/AimDocsContainer';

armReactScan();

const preview: Preview = {
  // In automated tests, runs before the addon's finalizer. Check settled content rather than
  // a heading or SVG caught halfway through a replay.
  afterEach: async ({ canvasElement }) => {
    if (import.meta.env.MODE !== 'test') return;
    await waitFor(
      () => {
        if (canvasElement.querySelector('[data-story-streaming="true"]')) throw new Error('Replay still streaming');
      },
      { timeout: 30000 }
    );
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'error',
    },

    docs: {
      container: AimDocsContainer,
      components: docsComponents,
    },

    // The sidebar is the reading order: evaluate (Introduction, Playground),
    // integrate (the feature branches), then dig (Performance Lab, QA).
    // Anything not named here sorts after the named entries, alphabetically.
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
  initialGlobals: {
    theme: getUserPreferredColorTheme(),
    reactScan: 'off',
    // Benchmark harnesses stream on mount here, but stay idle under vitest —
    // see the `initialGlobals` override in vitest.config.ts.
    autoStart: 'on',
  },
  globalTypes: {
    theme: {
      description: 'Global theme for components',
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
    reactScan: {
      description: 'Toggle react-scan render visualisation (outlines render only in standalone iframe view)',
      toolbar: {
        title: 'React Scan',
        icon: 'lightning',
        items: [
          { value: 'off', icon: 'eyeclose', title: 'Off' },
          { value: 'on', icon: 'eye', title: 'On (use Open Canvas in New Tab)' },
        ],
        dynamicTitle: true,
      },
    },
  },
  // withColorScheme sits last so it wraps outermost: the Mantine provider is a
  // component-level decorator, and it reads the color scheme through this
  // decorator's React context.
  decorators: [withReactScan, withColorScheme],
};

export default preview;
