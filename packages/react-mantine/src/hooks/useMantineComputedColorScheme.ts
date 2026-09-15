/**
 * The color scheme `MantineAIMarkdown` renders with when no `colorScheme`
 * prop is given: Mantine's `light` / `dark`, or under `auto` the operating
 * system preference.
 *
 * Mantine's own `useComputedColorScheme(defaultValue)` seeds the `auto`
 * branch with `defaultValue` and reads `matchMedia` in an effect, so on a
 * dark system the first client frame is light and flips to dark after
 * mount; every theme-dependent child (the mermaid diagram container, the
 * extra-styles scope) commits that light frame first. Its
 * `getInitialValueInEffect: false` option reads `matchMedia` during render
 * instead, which is right for a client render but wrong when hydrating
 * server markup that was rendered light.
 *
 * `useSyncExternalStore` handles both cases without the caller knowing
 * which one it is in: a client render uses the media query from the first
 * frame, and a hydration pass uses the server snapshot (light), then React
 * re-renders with the client value with no mismatch error.
 *
 * @module hooks/useMantineComputedColorScheme
 */

import { useSyncExternalStore } from 'react';
import { useMantineColorScheme, type MantineColorScheme } from '@mantine/core';

const DARK_QUERY = '(prefers-color-scheme: dark)';

const getDarkQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;

const subscribe = (onChange: () => void): (() => void) => {
  const query = getDarkQuery();
  if (!query || typeof query.addEventListener !== 'function') return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const getSnapshot = (): boolean => getDarkQuery()?.matches === true;

/** The server has no media query; light is what the server markup carries. */
const getServerSnapshot = (): boolean => false;

/** Exclude `auto` from what this hook returns. */
type ResolvedColorScheme = Exclude<MantineColorScheme, 'auto'>;

export function useMantineComputedColorScheme(): ResolvedColorScheme {
  const { colorScheme } = useMantineColorScheme();
  const systemDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (colorScheme === 'auto') return systemDark ? 'dark' : 'light';
  return colorScheme;
}
