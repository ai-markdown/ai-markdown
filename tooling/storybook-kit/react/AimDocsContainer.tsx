import { useEffect, useSyncExternalStore, useCallback, type ComponentProps } from 'react';
import { DocsContainer } from '@storybook/addon-docs/blocks';
import { CATALOG_THEMES, CATALOG_COLORS, catalogVariables } from '../common/catalogTheme';
import '../common/preview.css';
import { GLOBALS_UPDATED } from 'storybook/internal/core-events';
import { getPreviewColorTheme } from '@ai-markdown/storybook-kit/common/sb-theme';
import type { StoryColorScheme } from '@ai-markdown/storybook-kit/react/colorScheme';

/** Read the docs context's own channel. The latest event also survives a docs
 * remount; rereading the iframe URL would restore its stale initial theme. */
export const AimDocsContainer = (props: ComponentProps<typeof DocsContainer>) => {
  const { channel } = props.context;
  const subscribe = useCallback(
    (notify: () => void) => {
      channel.on(GLOBALS_UPDATED, notify);
      return () => channel.off(GLOBALS_UPDATED, notify);
    },
    [channel]
  );
  const getSnapshot = useCallback((): StoryColorScheme => {
    const theme = channel.last(GLOBALS_UPDATED)?.[0]?.globals?.theme;
    return theme === 'dark' || theme === 'light' ? theme : getPreviewColorTheme();
  }, [channel]);
  const scheme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    document.body.style.backgroundColor = CATALOG_COLORS[scheme].surface;
    document.body.style.colorScheme = scheme;
  }, [scheme]);

  return (
    <div className="aim-docs" style={{ ...catalogVariables(scheme), colorScheme: scheme }}>
      <DocsContainer {...props} theme={CATALOG_THEMES[scheme]} />
    </div>
  );
};
