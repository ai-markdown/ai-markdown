import { addons } from 'storybook/manager-api';
import { CATALOG_THEMES } from './catalogTheme';
import { getUserPreferredColorTheme, setUserPreferredColorTheme } from '@ai-markdown/storybook-kit/common/sb-theme';
import {
  CURRENT_STORY_WAS_SET,
  DOCS_PREPARED,
  DOCS_RENDERED,
  GLOBALS_UPDATED,
  STORY_PREPARED,
  STORY_RENDERED,
} from 'storybook/internal/core-events';

// Storybook uses white text on selected navigation rows, including in dark mode.
const managerThemes = {
  light: CATALOG_THEMES.light,
  dark: { ...CATALOG_THEMES.dark, colorSecondary: '#168875' },
};

addons.setConfig({
  theme: managerThemes[getUserPreferredColorTheme()],
});

addons.register('theme-switcher', (api) => {
  let currTheme: string | undefined = undefined;

  function updateTheme() {
    const theme = getUserPreferredColorTheme();
    if (theme && currTheme !== theme) {
      currTheme = theme;
      api.setOptions({
        theme: managerThemes[theme],
      });
    }
  }

  api.on(GLOBALS_UPDATED, ({ globals }) => {
    if (globals.theme) {
      setUserPreferredColorTheme(globals.theme);
      updateTheme();
    }
  });

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    updateTheme();
  });
});

// Storybook 10.6 can lose state of a composed catalog while the page loads.
// The manager keeps all catalogs in one `refs` object and replaces it on each
// update, starting from the last committed state. Two updates in one React
// batch therefore keep only the second. A catalog's index load and its
// preview's "current story was set" report often land together, and either
// can be the one dropped: without the index the catalog has no sidebar entries
// and no Controls; without the report Controls stay on the loading skeleton.
// Nothing repeats either update until the visitor reloads or changes story.
// Repeat them here until both are in the committed state. An addon panel that
// was drawn while the index was missing can stay empty until its tab is
// selected again; scripts/test-storybook-site.mjs allows for that.
addons.register('composed-catalog-state', (api) => {
  const running = new Map<string, number>();
  const requested = new Map<string, number>();
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reconcile = () => {
    let settled = true;
    for (const [id, ref] of Object.entries(api.getRefs())) {
      if (running.has(id) && !ref.previewInitialized) {
        settled = false;
        api.changeRefState(id, true);
      }
      if (!ref.index && !ref.indexError) {
        settled = false;
        // The first load may still be in flight; ask again only after it has
        // had time to finish, sooner when the catalog's preview is already
        // showing a story. A repeated request is served from the cache.
        const since = requested.get(id) ?? running.get(id) ?? started;
        if (Date.now() - since > (requested.has(id) || !running.has(id) ? 2000 : 500)) {
          requested.set(id, Date.now());
          void api.checkRef(ref);
        }
      }
    }
    // Stop once nothing is missing, or after a minute for a catalog that
    // cannot be reached.
    timer = settled || Date.now() - started > 60_000 ? undefined : setTimeout(reconcile, 100);
  };
  const channel = addons.getChannel();
  for (const event of [CURRENT_STORY_WAS_SET, STORY_PREPARED, DOCS_PREPARED, STORY_RENDERED, DOCS_RENDERED])
    channel.on(event, function (this: { refId?: string }) {
      if (!this?.refId) return;
      if (!running.has(this.refId)) running.set(this.refId, Date.now());
      if (!timer) reconcile();
    });
  reconcile();
});
