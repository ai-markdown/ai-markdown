import { CATALOG_COLORS } from '../common/catalogTheme';
import type { CSSProperties } from 'react';

export type ColorScheme = 'light' | 'dark';

export interface StreamingTheme {
  text: string;
  textMuted: string;
  panelBg: string;
  panelBorder: string;
  surfaceBorder: string;
  buttonBorder: string;
  buttonText: string;
  primaryBg: string;
  primaryText: string;
  chunkBg: string;
  chunkBorder: string;
  chunkText: string;
  chunkMuted: string;
  chunkIndex: string;
  chunkDelay: string;
  chunkSize: string;
  good: string;
  warn: string;
  bad: string;
}

/**
 * Thin, theme-tinted scrollbar as inline-able CSS (the standard
 * `scrollbar-width` / `scrollbar-color` pair — supported by Chrome 121+ and
 * Firefox, no ::-webkit-scrollbar style injection needed). Spread into the
 * style of any `overflow: auto` container; also settable on
 * `document.documentElement` to slim a page's own viewport scrollbar.
 */
export const thinScrollbar = (theme: StreamingTheme): { scrollbarWidth: 'thin'; scrollbarColor: string } => ({
  scrollbarWidth: 'thin',
  scrollbarColor: `${theme.panelBorder} transparent`,
});

/**
 * Control-row styling shared by the streaming benchmark stories (layout
 * column, button rows, buttons, monospace captions). Kept here — next to
 * the theme it derives from — so the comparison variants can't drift apart
 * visually one copy at a time.
 */
export interface ControlStyles {
  layout: CSSProperties;
  buttonRow: CSSProperties;
  baseButton: CSSProperties;
  primaryButton: CSSProperties;
  caption: CSSProperties;
}

export const controlStyles = (theme: StreamingTheme): ControlStyles => {
  const baseButton: CSSProperties = {
    background: 'transparent',
    border: `1px solid ${theme.buttonBorder}`,
    borderRadius: 7,
    color: theme.buttonText,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 13,
    minHeight: 34,
    padding: '6px 12px',
  };
  return {
    layout: {
      color: theme.text,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      padding: 12,
    },
    buttonRow: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 6 },
    baseButton,
    primaryButton: {
      ...baseButton,
      background: theme.primaryBg,
      border: `1px solid ${theme.primaryBg}`,
      color: theme.primaryText,
    },
    caption: {
      color: theme.textMuted,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 11,
    },
  };
};

export const getStreamingTheme = (scheme: ColorScheme): StreamingTheme => {
  const dark = scheme === 'dark';
  const palette = CATALOG_COLORS[scheme];
  return {
    text: palette.text,
    textMuted: palette.muted,
    panelBg: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    panelBorder: palette.border,
    surfaceBorder: dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)',
    buttonBorder: dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
    buttonText: dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.88)',
    primaryBg: palette.accent,
    primaryText: dark ? '#12251d' : '#ffffff',
    chunkBg: dark ? 'rgb(24, 24, 27)' : '#f6f8fa',
    chunkBorder: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    chunkText: dark ? '#d4d4d4' : '#1f2328',
    chunkMuted: dark ? '#888' : '#626b73',
    chunkIndex: dark ? '#6a9955' : '#1a7f37',
    chunkDelay: dark ? '#569cd6' : '#0550ae',
    chunkSize: dark ? '#ce9178' : '#bf3989',
    good: dark ? 'rgb(82, 196, 26)' : 'rgb(26, 127, 55)',
    warn: dark ? 'rgb(250, 173, 20)' : 'rgb(180, 124, 0)',
    bad: dark ? 'rgb(255, 77, 79)' : 'rgb(207, 34, 46)',
  };
};
