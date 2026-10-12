import { addons } from 'storybook/preview-api';
import { GLOBALS_UPDATED, UPDATE_GLOBALS } from 'storybook/internal/core-events';
import {
  getColorThemeMode,
  getUserPreferredColorTheme,
  resolveColorTheme,
  setColorThemeMode,
  watchSystemColorTheme,
} from './sb-theme';

/**
 * Two globals carry the color scheme.
 *
 * `themeMode` is the toolbar: System, Light or Dark. `theme` is what stories
 * and decorators read, and it is always a concrete `light` or `dark`, so no
 * reader has to know about "System". This module keeps `theme` equal to what
 * the mode means: when the mode changes, and, while the mode is System, when
 * the system setting or the theme of the documentation page around the
 * catalog changes.
 *
 * A `theme` given in the URL is a starting value. It is left alone until one
 * of those two things happens, which is what tests that pin a theme rely on.
 */
export const colorThemeInitialGlobals = () => ({ themeMode: getColorThemeMode(), theme: getUserPreferredColorTheme() });

export const colorThemeGlobalTypes = (description: string) => ({
  themeMode: {
    description,
    toolbar: {
      title: 'Theme',
      icon: 'mirror' as const,
      items: [
        { value: 'system', icon: 'browser' as const, title: 'System' },
        { value: 'light', icon: 'sun' as const, title: 'Light' },
        { value: 'dark', icon: 'moon' as const, title: 'Dark' },
      ],
      dynamicTitle: true,
    },
  },
  theme: { description: 'The resolved color scheme. Set by the Theme toolbar; stories read this.' },
});

/** Call once from a preview's configuration. */
export function syncColorTheme(): void {
  if (typeof window === 'undefined') return;
  const start = () => {
    // The configuration file can be evaluated before the preview has its channel; asking for it then would
    // create a stand-in that nothing listens to.
    if (!addons.hasChannel()) return void setTimeout(start, 50);
    const channel = addons.getChannel();
    let mode: unknown = getColorThemeMode();
    let pending: ReturnType<typeof setTimeout> | undefined;
    // Deferred: an update sent from inside the handler of another would reach later listeners first, and they
    // would then be left holding the older of the two.
    const apply = () => {
      clearTimeout(pending);
      pending = setTimeout(() => channel.emit(UPDATE_GLOBALS, { globals: { theme: resolveColorTheme(mode) } }), 0);
    };
    channel.on(GLOBALS_UPDATED, ({ globals }: { globals: Record<string, unknown> }) => {
      if (globals.themeMode === undefined || globals.themeMode === mode) return;
      mode = globals.themeMode;
      setColorThemeMode(mode);
      if (globals.theme !== resolveColorTheme(mode)) apply();
    });
    watchSystemColorTheme(() => {
      if (mode !== 'light' && mode !== 'dark') apply();
    });
  };
  start();
}
