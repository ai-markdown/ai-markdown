import { addons } from 'storybook/manager-api';
import { CATALOG_THEMES } from './catalogTheme';
import { getUserPreferredColorTheme, setUserPreferredColorTheme } from '@ai-markdown/storybook-kit/common/sb-theme';
import { GLOBALS_UPDATED } from 'storybook/internal/core-events';

// Storybook uses white text on selected navigation rows, including in dark mode.
const managerThemes = {
  light: CATALOG_THEMES.light,
  dark: { ...CATALOG_THEMES.dark, colorSecondary: '#168875' },
};

addons.setConfig({
  theme: managerThemes[getUserPreferredColorTheme()],
});

addons.register('theme-switcher', (api) => {
  let currTheme: string | undefined = undefined;

  function updateTheme() {
    const theme = getUserPreferredColorTheme();
    if (theme && currTheme !== theme) {
      currTheme = theme;
      api.setOptions({
        theme: managerThemes[theme],
      });
    }
  }

  api.on(GLOBALS_UPDATED, ({ globals }) => {
    if (globals.theme) {
      setUserPreferredColorTheme(globals.theme);
      updateTheme();
    }
  });

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    updateTheme();
  });
});
