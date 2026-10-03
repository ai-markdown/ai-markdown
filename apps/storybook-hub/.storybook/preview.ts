import type { Preview } from '@storybook/react-vite';
import { AimDocsContainer } from '@ai-markdown/storybook-kit/react/AimDocsContainer';
import { docsComponents } from '@ai-markdown/storybook-kit/react/docsComponents';
import { getUserPreferredColorTheme } from '@ai-markdown/storybook-kit/common/sb-theme';

const preview: Preview = {
  parameters: { docs: { container: AimDocsContainer, components: docsComponents } },
  initialGlobals: { theme: getUserPreferredColorTheme() },
  globalTypes: {
    theme: {
      description: 'Preview color scheme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        dynamicTitle: true,
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
        ],
      },
    },
  },
};
export default preview;
