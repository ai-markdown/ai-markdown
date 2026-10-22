// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createApp, createSSRApp, computed, defineComponent, h, nextTick, shallowRef, type App } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { useDiagram, DiagramViewport, type DiagramInput } from './diagram';
let app: App | undefined;
let host: HTMLElement;
afterEach(() => {
  app?.unmount();
  app = undefined;
  host?.remove();
});
const tick = async () => {
  for (let i = 0; i < 30; i++) await nextTick().then(() => Promise.resolve());
};
test('SSR is inert; loader identity resets synchronously and stale results cannot overwrite the new session', async () => {
  let release!: (value: { svg: string }) => void;
  const slow = vi.fn(async () => ({
    kind: 'svg' as const,
    render: () =>
      new Promise<{ svg: string }>((r) => {
        release = r;
      }),
  }));
  const value = shallowRef<DiagramInput>({
    code: 'A',
    colorScheme: 'light',
    streaming: false,
    active: true,
    resetKey: 'one',
    load: slow,
  });
  const View = defineComponent({
    setup() {
      const { state } = useDiagram(computed(() => value.value));
      return () => h('section', [h('output', state.value.view.kind), h(DiagramViewport, { view: state.value.view })]);
    },
  });
  expect(await renderToString(createSSRApp(View))).toContain('source');
  expect(slow).not.toHaveBeenCalled();
  host = document.createElement('div');
  document.body.append(host);
  app = createApp(View);
  app.mount(host);
  await tick();
  value.value = {
    ...value.value,
    resetKey: 'two',
    load: async () => ({ kind: 'svg', render: async () => ({ svg: '<svg data-new="yes"/>' }) }),
  };
  await tick();
  expect(host.querySelector('output')?.textContent).toBe('source');
  release({ svg: '<svg data-old="yes"/>' });
  await tick();
  expect(host.querySelector('[data-old]')).toBeNull();
  expect(host.querySelector('[data-new]')).not.toBeNull();
});

test('viewport cleans bindings on replacement, reports bind errors and installs the latest view after remount', async () => {
  const cleanup = vi.fn();
  const bind = vi.fn(() => cleanup);
  const failed = vi.fn();
  const view = shallowRef<import('./diagram').DiagramView>({
    kind: 'diagram',
    svg: '<svg data-first="yes"/>',
    chartType: '',
    bind,
  });
  const visible = shallowRef(true);
  const View = defineComponent({
    setup: () => () => (visible.value ? h(DiagramViewport, { view: view.value }) : null),
  });
  host = document.createElement('div');
  document.body.append(host);
  app = createApp(View);
  app.mount(host);
  await tick();
  expect(bind).toHaveBeenCalledTimes(1);
  view.value = {
    kind: 'diagram',
    svg: '<svg data-partial="yes"/>',
    chartType: '',
    bind: () => {
      throw new Error('binding failed');
    },
    onBindError: failed,
  };
  await tick();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'binding failed' }));
  expect(host.querySelector('svg')).toBeNull();
  visible.value = false;
  await tick();
  view.value = { kind: 'diagram', svg: '<svg data-latest="yes"/>', chartType: '', bind };
  visible.value = true;
  await tick();
  expect(host.querySelector('[data-latest]')).not.toBeNull();
  expect(bind).toHaveBeenCalledTimes(2);
  app.unmount();
  app = undefined;
  expect(cleanup).toHaveBeenCalledTimes(2);
});
