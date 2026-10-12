import { defineComponent, h, onBeforeUnmount, onMounted, ref, shallowRef, watch, type PropType } from 'vue';
import { createDiagramController, type DiagramState, type DiagramView } from '@ai-markdown/core/components';
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
type Diagram = Extract<DiagramView, { kind: 'diagram' }>;
const DiagramViewport = defineComponent({
  props: { diagram: { type: Object as PropType<Diagram>, required: true } },
  setup(props) {
    const target = ref<HTMLDivElement>();
    const install = () => {
      if (target.value) {
        target.value.innerHTML = props.diagram.svg;
        props.diagram.bind?.(target.value);
      }
    };
    onMounted(install);
    watch(() => props.diagram, install, { flush: 'post' });
    return () => h('div', { ref: target, class: 'aimd-diagram-viewport' });
  },
});
/** Draws what core's `createDiagramController` publishes; the render policy is documented there. */
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
      const state = shallowRef<DiagramState>({ view: { kind: 'source' }, loadFailed: false });
      const controller = createDiagramController(loadMermaid, (next) => {
        state.value = next;
      });
      watch(
        () => [props.code, props.colorScheme, props.streaming, props.active],
        () =>
          controller.update({
            code: props.code,
            dark: props.colorScheme === 'dark',
            streaming: props.streaming,
            active: props.active,
            interval,
          }),
        { immediate: true }
      );
      onBeforeUnmount(() => controller.dispose());
      return () => {
        const { view, loadFailed } = state.value;
        const waiting = view.kind === 'source' && !loadFailed;
        return h('div', { class: 'aimd-diagram', 'aria-busy': waiting }, [
          view.kind === 'diagram' && h(DiagramViewport, { diagram: view }),
          waiting && h('p', { role: 'status' }, props.streaming ? 'Waiting for diagram…' : 'Rendering diagram…'),
          (view.kind === 'error' || loadFailed) &&
            h('div', { role: 'alert' }, [
              h('p', view.kind === 'error' ? view.message : 'Diagram engine could not load.'),
              h('button', { type: 'button', onClick: () => controller.retry() }, 'Retry diagram'),
            ]),
        ]);
      };
    },
  });
}
