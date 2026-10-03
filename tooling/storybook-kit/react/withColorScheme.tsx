import { useEffect, type ReactNode } from 'react';
import type { Decorator } from '@storybook/react-vite';
import { catalogVariables } from '../common/catalogTheme';
import { storyPresentation } from '../common/storyPresentation';
import '../common/preview.css';
import { useGlobals } from 'storybook/preview-api';
import { ColorSchemeContext, PAGE_PALETTE, type StoryColorScheme } from '@ai-markdown/storybook-kit/react/colorScheme';

/**
 * Real React component, so the page-chrome writes land in an effect rather
 * than during render, and so `useEffect` is a plain rules-of-hooks-legal call.
 */
const ColorSchemeScope = ({ scheme, children }: { scheme: StoryColorScheme; children: ReactNode }) => {
  const palette = PAGE_PALETTE[scheme];

  useEffect(() => {
    document.body.style.backgroundColor = palette.background;
    document.body.style.colorScheme = scheme;
  }, [palette.background, scheme]);

  return (
    <ColorSchemeContext.Provider value={scheme}>
      {/* Carries the foreground color the page background needs. Without it,
          stories that render bare text inherit the browser default black and
          disappear against the dark canvas. */}
      <div style={{ color: palette.text }}>{children}</div>
    </ColorSchemeContext.Provider>
  );
};

export const withColorScheme: Decorator = (Story, context) => {
  // `useGlobals` is a Storybook *preview* hook, not a React hook; the
  // react-hooks plugin cannot tell the two apart in a lowercase-named
  // function. It has to be called in the decorator body — from a nested
  // component Storybook throws "preview hooks can only be called inside
  // decorators". Reading it here rather than from `context.globals` is also
  // what keeps docs pages live: they freeze the story context's globals but
  // keep feeding this hook.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [globals] = useGlobals();
  const scheme: StoryColorScheme = globals.theme === 'dark' ? 'dark' : 'light';

  const presentation = storyPresentation(context.title, context.name, context.viewMode, context.parameters.layout);
  return (
    <ColorSchemeScope scheme={scheme}>
      {presentation.bare ? (
        <Story />
      ) : (
        <div
          className="aim-story"
          data-embedded={context.viewMode === 'docs'}
          style={{ ...catalogVariables(scheme), colorScheme: scheme }}
        >
          {presentation.heading && (
            <header className="aim-story-header">
              <p className="aim-story-breadcrumb">{presentation.breadcrumb}</p>
              <p className="aim-story-title">{presentation.name}</p>
            </header>
          )}
          <div className="aim-story-body">
            <Story />
          </div>
        </div>
      )}
    </ColorSchemeScope>
  );
};
