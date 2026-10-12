// A new key: the previous one stored every theme the toolbar ever showed, so
// its values were never choices and must not pin anyone to a scheme.
const STORAGE_KEY = 'aim-storybook-color-scheme-mode';

export type ColorTheme = 'light' | 'dark';
/** What the toolbar offers: follow the surroundings, or stay on one scheme. */
export type ColorThemeMode = 'system' | ColorTheme;
const isColorTheme = (value: unknown): value is ColorTheme => value === 'light' || value === 'dark';

/** The page this catalog is embedded in, when it is the documentation site on the same origin. */
const embeddingRoot = (): HTMLElement | undefined => {
  try {
    if (window.top && window.top !== window) return window.top.document.documentElement;
  } catch {
    // A cross-origin parent: nothing to read.
  }
  return undefined;
};

/**
 * The scheme "System" means: the theme of the documentation page around the
 * catalog when there is one (it has its own light, dark and automatic
 * setting), otherwise the operating system's.
 */
export const getSystemColorTheme = (): ColorTheme => {
  const embedded = embeddingRoot()?.dataset.theme;
  if (isColorTheme(embedded)) return embedded;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/** The toolbar choice that was saved; "system" when none was. */
export const getColorThemeMode = (): ColorThemeMode => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isColorTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
};

/** Saves a fixed scheme; "system" is the absence of a saved choice. */
export const setColorThemeMode = (mode: unknown) => {
  try {
    if (isColorTheme(mode)) localStorage.setItem(STORAGE_KEY, mode);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is unavailable: the choice lasts for this page only.
  }
};

export const resolveColorTheme = (mode: unknown): ColorTheme => (isColorTheme(mode) ? mode : getSystemColorTheme());

/** The scheme to start with: the saved choice, or what "System" means right now. */
export const getUserPreferredColorTheme = (): ColorTheme => resolveColorTheme(getColorThemeMode());

/** Calls back when what "System" means changes: the system setting, or the theme of the embedding page. */
export const watchSystemColorTheme = (listener: (theme: ColorTheme) => void): (() => void) => {
  let current = getSystemColorTheme();
  const check = () => {
    const next = getSystemColorTheme();
    if (next === current) return;
    current = next;
    listener(next);
  };
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  query?.addEventListener('change', check);
  const root = embeddingRoot();
  const observer = root && new MutationObserver(check);
  if (root) observer!.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    query?.removeEventListener('change', check);
    observer?.disconnect();
  };
};

/** Standalone previews can select a theme through Storybook's globals URL. */
export const getPreviewColorTheme = (): ColorTheme => {
  const globals = new URLSearchParams(window.location.search).get('globals') ?? '';
  const theme = globals
    .split(';')
    .find((item) => item.startsWith('theme:'))
    ?.slice(6);
  return isColorTheme(theme) ? theme : getUserPreferredColorTheme();
};
