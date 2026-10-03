import { create } from 'storybook/theming';

/** Keep the catalog's chrome aligned with apps/docs/src/styles/custom.css. */
export const CATALOG_COLORS = {
  light: {
    background: '#f5f7f6',
    surface: '#ffffff',
    text: '#202b28',
    muted: '#526259',
    border: '#dce5df',
    accent: '#086b58',
  },
  dark: {
    background: '#121917',
    surface: '#1a2420',
    text: '#e7eee9',
    muted: '#a5b7ad',
    border: '#33473c',
    accent: '#a4dfcb',
  },
} as const;

export const CATALOG_THEMES = Object.fromEntries(
  (['light', 'dark'] as const).map((base) => {
    const palette = CATALOG_COLORS[base];
    return [
      base,
      create({
        base,
        brandTitle: 'AI Markdown',
        brandUrl: './',
        brandTarget: '_self',
        fontBase: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontCode: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        colorPrimary: palette.accent,
        colorSecondary: palette.accent,
        appBg: palette.background,
        appContentBg: palette.surface,
        appPreviewBg: palette.surface,
        appBorderColor: palette.border,
        appBorderRadius: 10,
        textColor: palette.text,
        textMutedColor: palette.muted,
        barTextColor: palette.muted,
        barSelectedColor: palette.accent,
        barHoverColor: palette.accent,
        barBg: palette.surface,
        inputBg: palette.surface,
        inputBorder: palette.border,
        inputTextColor: palette.text,
        inputBorderRadius: 6,
      }),
    ];
  })
) as Record<'light' | 'dark', ReturnType<typeof create>>;

export const catalogVariables = (scheme: 'light' | 'dark'): Record<string, string> =>
  Object.fromEntries(Object.entries(CATALOG_COLORS[scheme]).map(([key, value]) => [`--catalog-${key}`, value]));
