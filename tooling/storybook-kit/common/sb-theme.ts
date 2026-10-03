const STORAGE_KEY = 'aim-storybook-color-scheme';

export const getUserPreferredColorTheme = (): 'light' | 'dark' => {
  const theme = localStorage.getItem(STORAGE_KEY);
  if (theme === 'light' || theme === 'dark') return theme;
  if (!window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const setUserPreferredColorTheme = (theme: string) => {
  localStorage.setItem(STORAGE_KEY, theme);
};

/** Standalone previews can select a theme through Storybook's globals URL. */
export const getPreviewColorTheme = (): 'light' | 'dark' => {
  const globals = new URLSearchParams(window.location.search).get('globals') ?? '';
  const theme = globals
    .split(';')
    .find((item) => item.startsWith('theme:'))
    ?.slice(6);
  return theme === 'light' || theme === 'dark' ? theme : getUserPreferredColorTheme();
};
