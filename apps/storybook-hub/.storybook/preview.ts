import type { Preview } from '@storybook/react-vite';
import { AimDocsContainer } from '@ai-markdown/storybook-kit/react/AimDocsContainer';
import { docsComponents } from '@ai-markdown/storybook-kit/react/docsComponents';
import {
  colorThemeGlobalTypes,
  colorThemeInitialGlobals,
  syncColorTheme,
} from '@ai-markdown/storybook-kit/common/colorThemeGlobals';

syncColorTheme();

const preview: Preview = {
  parameters: { docs: { container: AimDocsContainer, components: docsComponents } },
  initialGlobals: { ...colorThemeInitialGlobals() },
  globalTypes: {
    ...colorThemeGlobalTypes('Preview color scheme'),
  },
};
export default preview;
