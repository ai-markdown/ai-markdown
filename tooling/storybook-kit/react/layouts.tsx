import React, { type CSSProperties, type ReactNode } from 'react';
import { useStoryColorScheme, PAGE_PALETTE } from '@ai-markdown/storybook-kit/react/colorScheme';
import { getStreamingTheme } from '@ai-markdown/storybook-kit/react/theme';

/**
 * Shared presentation shells for the documentation stories. The benchmark
 * harnesses under Performance Lab keep their own bespoke layouts — those
 * panels encode measurement semantics and are not worth genericizing.
 */

const labelStyle = (color: string): CSSProperties => ({
  color,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12,
  letterSpacing: 0.2,
  marginBottom: 8,
});

/** A single captioned panel. The caption is the thing being demonstrated. */
export const Labeled = ({ label, children }: { label: ReactNode; children: ReactNode }) => {
  const theme = getStreamingTheme(useStoryColorScheme());
  return (
    <div style={{ minWidth: 0 }}>
      <div style={labelStyle(theme.textMuted)}>{label}</div>
      {children}
    </div>
  );
};

/**
 * Two captioned panels side by side — the shape every on/off comparison in
 * this Storybook uses. Below ~720px the columns stack, so the docs page and a
 * narrow canvas both stay readable. The stacking is a plain media query in a
 * `<style>` element rather than a JS width listener: the docs page renders the
 * canvas at an arbitrary width and never notifies anyone when it changes.
 */
export const SideBySide = ({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: ReactNode;
  right: ReactNode;
  leftLabel: ReactNode;
  rightLabel: ReactNode;
}) => {
  return (
    <div className="aim-comparison">
      <div className="aim-comparison-panel">
        <div className="aim-panel-label">{leftLabel}</div>
        <div className="aim-panel-content">{left}</div>
      </div>
      <div className="aim-comparison-panel">
        <div className="aim-panel-label">{rightLabel}</div>
        <div className="aim-panel-content">{right}</div>
      </div>
    </div>
  );
};

/**
 * A live readout of CSS custom properties: name, a swatch for the ones that
 * hold a color, and the value the browser actually resolved. Reading through
 * `getComputedStyle` rather than a hardcoded table is the point — the row
 * shows what the token IS right now, including whatever a story-level
 * override or the color-scheme switch did to it.
 *
 * `target` must be an element INSIDE the typography root (the root itself is
 * ideal). The library declares its tokens on `.aim-typography-root.default`
 * and on the color-scheme classes beside it, so nothing above that element —
 * `document.documentElement` included — resolves them to anything.
 */
export const TokenGrid = ({ tokens, target }: { tokens: readonly string[]; target?: HTMLElement | null }) => {
  const scheme = useStoryColorScheme();
  const theme = getStreamingTheme(scheme);
  // Resolution is deferred to an effect: on the first render `target` has not
  // been measured yet, and computed values are DOM reads either way.
  const [values, setValues] = React.useState<Record<string, string>>({});
  // The effect depends on the joined names rather than on the array: callers
  // naturally write the token list inline, and a fresh array identity on every
  // render would re-run the effect, set state, and re-render forever.
  const tokenKey = tokens.join('|');
  React.useEffect(() => {
    if (!target) return;
    const computed = getComputedStyle(target);
    const next: Record<string, string> = {};
    for (const token of tokenKey.split('|')) next[token] = computed.getPropertyValue(token).trim();
    setValues(next);
  }, [tokenKey, target, scheme]);

  const mono: CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
  };
  return (
    <div style={{ ...mono, color: PAGE_PALETTE[scheme].text, display: 'grid', gap: 6 }}>
      {tokens.map((token) => {
        const value = values[token] ?? '';
        // Only the color tokens get a swatch. The swatch is painted with the
        // RESOLVED value, not with `var(--token)`: this grid renders outside
        // the typography root, where the token name means nothing.
        const isColor = value !== '' && CSS.supports('color', value);
        return (
          <div
            key={token}
            style={{ alignItems: 'center', display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 20em) 28px 1fr' }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{token}</span>
            {isColor ? (
              <span
                aria-hidden
                style={{
                  background: value,
                  border: `1px solid ${theme.panelBorder}`,
                  borderRadius: 4,
                  height: 20,
                  width: 28,
                }}
              />
            ) : (
              <span />
            )}
            <span style={{ color: theme.textMuted, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || '—'}</span>
          </div>
        );
      })}
    </div>
  );
};
