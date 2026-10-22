import {
  computed,
  shallowRef,
  onMounted,
  onBeforeUnmount,
  watch,
  defineComponent,
  h,
  ref,
  type ComputedRef,
  type PropType,
} from 'vue';
import {
  createDiagramController,
  resolveDiagramInterval,
  type DiagramInput,
  type DiagramState,
  type DiagramView,
} from '@ai-markdown/core/components';
import { applyDiagramPalette } from './diagramPalette';

/** Vue counterpart of the React hook; setup/SSR never starts an engine. */
export function useDiagram(input: ComputedRef<DiagramInput>) {
  const mounted = ref(false);
  const session = shallowRef<{
    load: DiagramInput['load'];
    fallback: DiagramInput['fallback'];
    resetKey: string;
    controller: ReturnType<typeof createDiagramController>;
  }>();
  const snapshot = shallowRef<DiagramState>({ view: { kind: 'source' }, loadFailed: false });
  const initial: DiagramState = { view: { kind: 'source' }, loadFailed: false };
  const matches = () =>
    session.value?.load === input.value.load &&
    session.value?.fallback === input.value.fallback &&
    session.value?.resetKey === input.value.resetKey;
  const state = computed(() => (matches() ? snapshot.value : initial));
  watch(
    [input, mounted],
    ([next, ready]) => {
      if (!ready) return;
      if (!matches()) {
        session.value?.controller.dispose();
        snapshot.value = initial;
        const controller = createDiagramController(
          next.load,
          (value) => {
            if (session.value?.controller === controller) snapshot.value = value;
          },
          next.fallback
        );
        session.value = { load: next.load, fallback: next.fallback, resetKey: next.resetKey, controller };
      }
      session.value!.controller.update({
        code: next.code,
        dark: next.colorScheme === 'dark',
        streaming: next.streaming,
        active: next.active,
        interval: resolveDiagramInterval(next.intervalMs),
      });
    },
    { flush: 'post' }
  );
  onMounted(() => {
    mounted.value = true;
  });
  onBeforeUnmount(() => {
    mounted.value = false;
    session.value?.controller.dispose();
    session.value = undefined;
  });
  return {
    state,
    retry: () => {
      if (mounted.value && matches() && session.value) {
        const next = input.value;
        session.value.controller.update({
          code: next.code,
          dark: next.colorScheme === 'dark',
          streaming: next.streaming,
          active: next.active,
          interval: resolveDiagramInterval(next.intervalMs),
        });
        session.value.controller.retry();
      }
    },
  };
}

export const DiagramViewport = defineComponent({
  name: 'DiagramViewport',
  props: { view: { type: Object as PropType<DiagramView>, required: true } },
  setup(props) {
    const target = ref<HTMLElement>();
    let cleanup: void | (() => void);
    const clear = () => {
      try {
        cleanup?.();
      } finally {
        cleanup = undefined;
        target.value?.replaceChildren();
      }
    };
    const install = () => {
      clear();
      const host = target.value,
        view = props.view;
      if (!host || view.kind !== 'diagram') return;
      try {
        host.innerHTML = view.svg;
        applyDiagramPalette(host, view);
        cleanup = view.bind?.(host);
      } catch (error) {
        host.replaceChildren();
        if (view.onBindError) view.onBindError(error);
        else throw error;
      }
    };
    watch(() => [props.view, target.value], install, { flush: 'post' });
    onBeforeUnmount(clear);
    return () => h('div', { ref: target });
  },
});
export { createPeleLoader, createOndineLoader, preloadDiagramEngine } from '@ai-markdown/core/components';
export type { DiagramInput, DiagramState, DiagramView, DiagramEngineLoader } from '@ai-markdown/core/components';
