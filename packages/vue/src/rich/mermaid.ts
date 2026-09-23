import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue';
import { createDiagramController, type DiagramState } from '@ai-markdown/core/components';
let engine: ReturnType<typeof importMermaid> | undefined;
function importMermaid() {
  return import('mermaid').then((module) => module.default);
}
function loadMermaid() {
  return (engine ??= importMermaid().catch((error) => {
    engine = undefined;
    throw error;
  }));
}
/** Warm the optional engine without exposing its types in the public API. */
export function preloadCodeAssets(): Promise<void> {
  return loadMermaid().then(() => undefined);
}
const DiagramViewport = defineComponent({
  props: { state: { type: Object as PropType<DiagramState>, required: true } },
  setup(props) {
    const target = ref<HTMLDivElement>();
    const install = () => {
      if (target.value) {
        target.value.innerHTML = props.state.svg;
        props.state.bind?.(target.value);
      }
    };
    onMounted(install);
    watch(() => [props.state.svg, props.state.bind], install, { flush: 'post' });
    return () => h('div', { ref: target, class: 'aimd-diagram-viewport' });
  },
});
export function createMermaidRenderer(interval = 300) {
  interval = Number.isFinite(interval) && interval >= 0 ? interval : 300;
  return defineComponent({
    name: 'MermaidRenderer',
    props: {
      code: { type: String, required: true },
      colorScheme: String as PropType<'light' | 'dark'>,
      streaming: Boolean,
      active: Boolean,
      resetKey: { type: String, required: true },
      language: String,
    },
    setup(props) {
      const state = ref<DiagramState>({ status: 'loading', svg: '' });
      const controller = createDiagramController(loadMermaid, (next) => {
        state.value = next;
      });
      const update = () =>
        controller.update({
          code: props.code,
          dark: props.colorScheme === 'dark',
          streaming: props.streaming,
          active: props.active,
          resetKey: props.resetKey,
          interval,
        });
      watch(() => [props.code, props.colorScheme, props.streaming, props.active, props.resetKey], update, {
        immediate: true,
      });
      onBeforeUnmount(() => controller.dispose());
      return () =>
        h('div', { class: 'aimd-diagram', 'aria-busy': state.value.status === 'loading' }, [
          state.value.svg && h(DiagramViewport, { state: state.value }),
          state.value.status === 'loading' &&
            !state.value.svg &&
            h('p', { role: 'status' }, props.streaming ? 'Waiting for diagram…' : 'Rendering diagram…'),
          state.value.status === 'error' &&
            h('div', { role: 'alert' }, [
              h('p', state.value.error),
              h('button', { type: 'button', onClick: update }, 'Retry diagram'),
            ]),
        ]);
    },
  });
}
