// mermaid 11's `initialize` replaces the site config with defaults + the
// keys passed in. These tests drive `ensureMermaidInitialized` against a
// stub that mirrors that replace semantics, and check that host keys
// survive, that `sandbox` is not downgraded, that `loose` is upgraded, and
// that `initialize` is not called when nothing needs to change.
import type { MermaidConfig } from 'mermaid';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ensureMermaidInitialized, resetMermaidInitializationForTests } from './initialize';

const DEFAULT_FONT = '"trebuchet ms", verdana, arial, sans-serif';

/** mermaid's defaults for the keys this test cares about. */
const defaults = (): MermaidConfig => ({
  theme: 'default',
  securityLevel: 'strict',
  darkMode: false,
  startOnLoad: true,
  themeVariables: { fontFamily: DEFAULT_FONT, primaryColor: '#ececff' },
});

/**
 * A stub mermaid whose `initialize` behaves like `setSiteConfig`: the site
 * config becomes defaults + the passed keys, and `themeVariables` is the
 * theme's computed set with the passed keys as overrides (so a full computed
 * set passed back overrides everything, as in mermaid).
 */
function createMermaidStub(hostConfig: MermaidConfig, { withSiteConfig = true } = {}) {
  let site: MermaidConfig = { ...defaults(), ...hostConfig };
  const initialize = vi.fn((conf: MermaidConfig) => {
    site = {
      ...defaults(),
      ...conf,
      themeVariables: { ...defaults().themeVariables, ...(conf.themeVariables ?? {}) },
    };
    if (conf.fontFamily && !conf.themeVariables?.fontFamily) {
      site.themeVariables.fontFamily = conf.fontFamily;
    }
  });
  const copy = () => ({ ...site, themeVariables: { ...site.themeVariables } });
  return {
    initialize,
    mermaidAPI: withSiteConfig ? { getSiteConfig: copy, getConfig: copy } : { getConfig: copy },
    get site() {
      return site;
    },
  };
}

beforeEach(resetMermaidInitializationForTests);

describe('ensureMermaidInitialized', () => {
  test('host keys survive and loose is upgraded to strict', () => {
    const mermaid = createMermaidStub({
      securityLevel: 'loose',
      fontFamily: 'Inter, sans-serif',
      flowchart: { htmlLabels: false, curve: 'linear' },
      startOnLoad: false,
    });
    ensureMermaidInitialized(mermaid, true);
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    const passed = mermaid.initialize.mock.calls[0][0];
    expect(passed.securityLevel).toBe('strict');
    expect(passed.fontFamily).toBe('Inter, sans-serif');
    expect(passed.flowchart).toEqual({ htmlLabels: false, curve: 'linear' });
    expect(passed.startOnLoad).toBe(false);
    expect(passed.suppressErrorRendering).toBe(true);
    expect(passed.theme).toBe('dark');
    expect(passed.darkMode).toBe(true);
    expect(mermaid.site.securityLevel).toBe('strict');
    expect(mermaid.site.fontFamily).toBe('Inter, sans-serif');
  });

  test('antiscript and an unset level are upgraded too', () => {
    for (const securityLevel of ['antiscript', undefined] as const) {
      const mermaid = createMermaidStub({ securityLevel, theme: 'forest', suppressErrorRendering: true });
      ensureMermaidInitialized(mermaid, false);
      expect(mermaid.initialize).toHaveBeenCalledTimes(1);
      expect(mermaid.site.securityLevel).toBe('strict');
    }
  });

  test('sandbox is kept, not downgraded to strict', () => {
    const mermaid = createMermaidStub({ securityLevel: 'sandbox' });
    ensureMermaidInitialized(mermaid, false);
    // Theme and suppressErrorRendering still needed setting; the level did not.
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    expect(mermaid.site.securityLevel).toBe('sandbox');
    expect(mermaid.site.theme).toBe('base');
  });

  test('a host-chosen theme and its themeVariables are left alone', () => {
    const mermaid = createMermaidStub({
      theme: 'forest',
      themeVariables: { fontFamily: DEFAULT_FONT, primaryColor: '#cde498', lineColor: 'green' },
    });
    ensureMermaidInitialized(mermaid, true);
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    expect(mermaid.site.theme).toBe('forest');
    expect(mermaid.site.darkMode).toBe(false);
    expect(mermaid.site.themeVariables).toEqual({
      fontFamily: DEFAULT_FONT,
      primaryColor: '#cde498',
      lineColor: 'green',
    });
    // The color scheme flip does not touch a host theme either.
    ensureMermaidInitialized(mermaid, false);
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    expect(mermaid.site.theme).toBe('forest');
  });

  test('nothing is re-initialized when nothing needs to change', () => {
    const mermaid = createMermaidStub({});
    ensureMermaidInitialized(mermaid, true);
    ensureMermaidInitialized(mermaid, true);
    ensureMermaidInitialized(mermaid, true);
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    // A host already on our exact settings is not touched at all.
    const settled = createMermaidStub({ theme: 'base', darkMode: false, suppressErrorRendering: true });
    ensureMermaidInitialized(settled, false);
    expect(settled.initialize).not.toHaveBeenCalled();
  });

  test('the theme we wrote follows the color scheme; the previous theme variables do not leak', () => {
    const mermaid = createMermaidStub({ themeVariables: { fontFamily: 'Inter', primaryColor: '#ececff' } });
    ensureMermaidInitialized(mermaid, true);
    expect(mermaid.site.theme).toBe('dark');
    // The stub's "computed" dark variables carry a marker so a leak is visible.
    mermaid.site.themeVariables.primaryColor = '#1f2020';
    ensureMermaidInitialized(mermaid, false);
    expect(mermaid.initialize).toHaveBeenCalledTimes(2);
    const passed = mermaid.initialize.mock.calls[1][0];
    expect(passed.theme).toBe('base');
    expect(passed.darkMode).toBe(false);
    // Only fontFamily crosses the switch; the dark computed colors stay behind.
    expect(passed.themeVariables).toEqual({ fontFamily: 'Inter' });
  });

  test('a host that re-initializes with loose after us is upgraded again, once', () => {
    const mermaid = createMermaidStub({});
    ensureMermaidInitialized(mermaid, false);
    // Host re-initializes the way the mermaid docs show for click handlers.
    mermaid.initialize({ securityLevel: 'loose', fontFamily: 'Georgia' });
    ensureMermaidInitialized(mermaid, false);
    expect(mermaid.initialize).toHaveBeenCalledTimes(3);
    expect(mermaid.site.securityLevel).toBe('strict');
    expect(mermaid.site.fontFamily).toBe('Georgia');
    ensureMermaidInitialized(mermaid, false);
    expect(mermaid.initialize).toHaveBeenCalledTimes(3);
  });

  test('falls back to getConfig when getSiteConfig is missing', () => {
    const mermaid = createMermaidStub({ securityLevel: 'loose', fontFamily: 'Inter' }, { withSiteConfig: false });
    ensureMermaidInitialized(mermaid, false);
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    expect(mermaid.initialize.mock.calls[0][0].fontFamily).toBe('Inter');
    expect(mermaid.site.securityLevel).toBe('strict');
  });

  test('a mermaid without mermaidAPI still gets initialized safely', () => {
    const initialize = vi.fn();
    ensureMermaidInitialized({ initialize }, true);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize.mock.calls[0][0]).toMatchObject({ securityLevel: 'strict', theme: 'dark', darkMode: true });
  });
});
