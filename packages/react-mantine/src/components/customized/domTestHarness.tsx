// Shared harness for the package's client-side (react-dom/client under
// jsdom) tests. Test files stay `// @vitest-environment jsdom`; this module
// only provides the stubs Mantine needs to mount and a mount/cleanup pair
// that keeps every render inside `act`.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider, type MantineProviderProps } from '@mantine/core';
import { CodeHighlightAdapterProvider, type CodeHighlightAdapter } from '@mantine/code-highlight';

type ProviderProps = Omit<MantineProviderProps, 'children'>;

/** jsdom ships neither matchMedia (Mantine's color-scheme manager) nor
 *  ResizeObserver (Mantine's ScrollArea, used by CodeHighlight). */
export function installMantineDomStubs() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/** Let pending microtasks (resolved adapter promises, state updates) reach React. */
export const flushEffects = () => act(async () => {});

export function createMountHarness() {
  const roots: { root: Root; container: HTMLElement; adapter: CodeHighlightAdapter; providerProps?: ProviderProps }[] =
    [];
  const wrap = (ui: ReactNode, adapter: CodeHighlightAdapter, providerProps?: ProviderProps) => (
    <MantineProvider {...providerProps}>
      <CodeHighlightAdapterProvider adapter={adapter}>{ui}</CodeHighlightAdapterProvider>
    </MantineProvider>
  );
  return {
    /** Mount `ui` under MantineProvider + CodeHighlightAdapterProvider, the README consumer setup. */
    async mount(ui: ReactNode, adapter: CodeHighlightAdapter, providerProps?: ProviderProps): Promise<HTMLElement> {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      roots.push({ root, container, adapter, providerProps });
      await act(async () => {
        root.render(wrap(ui, adapter, providerProps));
      });
      return container;
    },
    /** Re-render the most recently mounted root with new `ui` (same providers, same adapter). */
    async update(ui: ReactNode): Promise<void> {
      const last = roots[roots.length - 1];
      if (!last) throw new Error('update() called before mount()');
      await act(async () => {
        last.root.render(wrap(ui, last.adapter, last.providerProps));
      });
    },
    async cleanup() {
      for (const { root, container } of roots.splice(0)) {
        await act(async () => root.unmount());
        container.remove();
      }
    },
  };
}

/** Dispatch a real click on the element with the given accessible name. */
export async function clickByLabel(container: HTMLElement, label: string) {
  const button = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!button) throw new Error(`no element with aria-label="${label}"`);
  await act(async () => {
    button.click();
  });
  return button;
}
