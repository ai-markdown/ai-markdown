import { CATALOG_COLORS } from '../common/catalogTheme';
import { createContext, useContext, type ReactNode } from 'react';

export type StoryColorScheme = 'light' | 'dark';

export interface PagePalette {
  /**
   * Written straight onto `document.body.style.backgroundColor`. The canvas and docs shell use the same surface.
   */
  background: string;
  /** Body text color, inherited by every story through the decorator's wrapper. */
  text: string;
}

/**
 * The single source of truth for story page chrome. These values used to be
 * hardcoded in packages/react/stories/decorators.tsx; the text colors match
 * `getStreamingTheme()` in packages/react/stories/streaming/theme.ts so the
 * benchmark harnesses and plain stories agree on foreground contrast.
 */
export const PAGE_PALETTE: Record<StoryColorScheme, PagePalette> = {
  light: { background: CATALOG_COLORS.light.surface, text: CATALOG_COLORS.light.text },
  dark: { background: CATALOG_COLORS.dark.surface, text: CATALOG_COLORS.dark.text },
};

export const ColorSchemeContext = createContext<StoryColorScheme>('light');

/**
 * The story-side view of the `theme` toolbar global. Provided by
 * `withColorScheme` (a global decorator, so it wraps every story and every
 * component-level decorator). Call this instead of reading
 * `context.globals.theme` — the docs page freezes `context.globals`, so
 * direct reads go stale there while this context stays live.
 */
export const useStoryColorScheme = (): StoryColorScheme => useContext(ColorSchemeContext);

/**
 * Bridge for story `render` slots. A `render` function is a plain function,
 * not a component, so it cannot call `useStoryColorScheme()` directly — this
 * is the smallest legal place to make the call:
 *
 * ```tsx
 * render: (args) => <WithScheme>{(scheme) => <Thing colorScheme={scheme} />}</WithScheme>
 * ```
 */
export const WithScheme = ({ children }: { children: (colorScheme: StoryColorScheme) => ReactNode }) => {
  const colorScheme = useStoryColorScheme();
  return <>{children(colorScheme)}</>;
};
