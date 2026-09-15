import type { MermaidConfig } from 'mermaid';

/** The part of the mermaid module this file touches. Structural so tests can
 *  pass a stub; `mermaidAPI` is deprecated in mermaid's types but present at
 *  runtime in mermaid 11, and it is the only place `getSiteConfig` /
 *  `getConfig` live (the default export has neither). */
export type MermaidInitTarget = {
  initialize: (config: MermaidConfig) => void;
  mermaidAPI?: {
    getSiteConfig?: () => MermaidConfig;
    getConfig?: () => MermaidConfig;
  };
};

/**
 * `securityLevel` values under which mermaid still sanitizes what it emits.
 * `sandbox` is stricter than `strict` (the diagram renders inside a sandboxed
 * iframe), so a host that chose it must not be downgraded. `loose` and
 * `antiscript` skip DOMPurify and are upgraded to `strict`; so is an unset
 * value, which mermaid treats as `strict` but which we pin explicitly so the
 * guard below has something to compare against.
 */
const SAFE_SECURITY_LEVELS: ReadonlySet<string | undefined> = new Set(['strict', 'sandbox']);

/** Theme we last wrote. mermaid's config is a module-level singleton, so this
 *  is module-level too: instances under providers with DIFFERENT color
 *  schemes each re-assert before their own render, and the check runs per
 *  attempt (each streamed chunk re-runs the effect) rather than once per
 *  instance. It also tells a theme WE wrote apart from one the host wrote —
 *  the host's choice is left alone; ours follows the color scheme. */
let ownedTheme: 'dark' | 'base' | null = null;

/** Test hook: forget the theme cache so each test starts from a cold module. */
export const resetMermaidInitializationForTests = () => {
  ownedTheme = null;
};

/**
 * Read the config `mermaid.initialize` would replace. `getSiteConfig` is the
 * site config (what the host passed to `initialize`, merged over mermaid's
 * defaults); `getConfig` is the per-render config with `%%{init}%%`
 * directives merged in and is only a fallback for builds without the former.
 */
const readSiteConfig = (mermaid: MermaidInitTarget): MermaidConfig => {
  const api = mermaid.mermaidAPI;
  return api?.getSiteConfig?.() ?? api?.getConfig?.() ?? {};
};

/** mermaid's own default for `maxTextSize` (`MAX_TEXTLENGTH` in mermaidAPI). */
export const MERMAID_DEFAULT_MAX_TEXT_SIZE = 50_000;

/**
 * The effective `maxTextSize`. `mermaid.render` does not reject oversized
 * input: it swaps in a placeholder diagram ("Maximum text size in diagram
 * exceeded") and resolves normally, and `mermaid.parse` has no size gate at
 * all, so the whole text is parsed first. The renderer checks this before
 * parsing and reports the size as an error instead. The key is in mermaid's
 * `secure` list, so a `%%{init}%%` directive cannot raise it and the site
 * config is the value that applies.
 */
export const getMermaidMaxTextSize = (mermaid: MermaidInitTarget): number => {
  const configured = readSiteConfig(mermaid).maxTextSize;
  return typeof configured === 'number' && Number.isFinite(configured) && configured >= 0
    ? configured
    : MERMAID_DEFAULT_MAX_TEXT_SIZE;
};

/**
 * mermaid's config is a module-level singleton shared with the host
 * application when the bundler dedupes the package, and a host that enables
 * `click` interactions calls `mermaid.initialize({ securityLevel: 'loose' })`
 * — the officially documented way. Under `loose` mermaid skips DOMPurify
 * and its output goes into this component's `innerHTML` verbatim: an
 * LLM-authored diagram string could then run script in the page origin.
 * So a theme cache alone is not enough of a guard: before every render the
 * current `securityLevel` is read back (a config copy, still far cheaper
 * than `initialize`'s merge + theme variables + diagram registration) and an
 * unsafe value forces a re-initialize
 * (2026-08-19 review r2 P2-11; the v2.4.2 "documented premise" made this
 * the host's problem — it is ours, the innerHTML is ours).
 *
 * In mermaid 11 `initialize` goes through `setSiteConfig`, which REPLACES
 * the site config with defaults + the keys passed in. Calling it with only
 * our keys wiped the host's `theme`, `fontFamily`, `flowchart` options and
 * so on, and turned a host `sandbox` into `strict` (3.0.2 review). So:
 * - the current site config is read back and passed through with our
 *   overrides on top, so host keys survive;
 * - `sandbox` is accepted as is; only `loose` / `antiscript` / unset become
 *   `strict`;
 * - a theme the host chose is kept (with its `themeVariables`); the color
 *   scheme switch only applies to the theme when the host has not chosen
 *   one, or when the current theme is one we wrote;
 * - when nothing needs to change, `initialize` is not called at all, so a
 *   host on `strict`/`sandbox` and this component stop overwriting each
 *   other on every render.
 */
export const ensureMermaidInitialized = (mermaid: MermaidInitTarget, isDark: boolean) => {
  const site = readSiteConfig(mermaid);
  const wantedTheme = isDark ? 'dark' : 'base';

  // `default` is mermaid's own initial value, so it does not count as a host
  // choice. A theme equal to the one we last wrote is ours to switch.
  const hostOwnsTheme = site.theme !== undefined && site.theme !== 'default' && site.theme !== ownedTheme;

  const levelOk = SAFE_SECURITY_LEVELS.has(site.securityLevel);
  const themeOk = hostOwnsTheme || (site.theme === wantedTheme && Boolean(site.darkMode) === isDark);
  const suppressOk = site.suppressErrorRendering === true;
  if (levelOk && themeOk && suppressOk) return;

  const next: MermaidConfig = {
    ...site,
    // Without this, a draw-phase throw (an error that got past
    // mermaid.parse) leaves mermaid's temp element orphaned in document.body
    // — its error path only cleans up when this flag is set. We render our
    // own error tab anyway, so mermaid's built-in error diagram is dead
    // weight here regardless.
    suppressErrorRendering: true,
  };
  if (!levelOk) {
    next.securityLevel = 'strict';
  }
  if (!hostOwnsTheme) {
    next.theme = wantedTheme;
    next.darkMode = isDark;
    // The site config carries the PREVIOUS theme's fully computed
    // `themeVariables`. `initialize` feeds `themeVariables` into the new
    // theme as overrides for every key present, so passing them back would
    // make the new theme look exactly like the old one. Drop them and keep
    // only `fontFamily`: `default`, `base` and `dark` share the same font
    // default, so a value that differs is the host's and survives the switch
    // (a top-level `fontFamily` survives through the spread above either way).
    const fontFamily: unknown = (site.themeVariables as { fontFamily?: unknown } | undefined)?.fontFamily;
    if (typeof fontFamily === 'string') {
      next.themeVariables = { fontFamily };
    } else {
      delete next.themeVariables;
    }
    ownedTheme = wantedTheme;
  }
  mermaid.initialize(next);
};
