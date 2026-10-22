import { computed, defineComponent, h, type PropType } from 'vue';
import {
  defaultDiagramLabels,
  diagramErrorText,
  resolveLabels,
  type DiagramLabels,
  type LabelsOption,
  type DiagramEngineLoader,
} from '@ai-markdown/core/components';
import { useDiagram, DiagramViewport } from './diagram';
export function createDiagramRenderer(
  intervalMs: number | undefined,
  configuredLabels: LabelsOption<DiagramLabels> | undefined,
  configuredEngine: DiagramEngineLoader | false | undefined,
  defaultEngine?: DiagramEngineLoader,
  configuredFallback = true
) {
  const load = configuredEngine || defaultEngine;
  if (!load) throw new Error('An explicit diagram engine is required');
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
      const { state, retry } = useDiagram(
        computed(() => ({
          ...props,
          colorScheme: props.colorScheme ?? 'light',
          intervalMs,
          load,
          fallback: configuredFallback && load !== defaultEngine ? defaultEngine : undefined,
        }))
      );
      return () => {
        const { view, loadFailed } = state.value;
        const waiting = view.kind === 'source' && !loadFailed;
        const labels = resolveLabels(defaultDiagramLabels, configuredLabels);
        return h('div', { class: 'aimd-diagram', 'aria-busy': waiting }, [
          h(DiagramViewport, { view, class: 'aimd-diagram-viewport' }),
          waiting && h('p', { role: 'status' }, props.streaming ? labels.waiting : labels.rendering),
          (view.kind === 'error' || loadFailed) &&
            h('div', { role: 'alert' }, [
              h('p', view.kind === 'error' ? diagramErrorText(view, labels) : labels.loadFailed),
              h('button', { type: 'button', onClick: retry }, labels.retry),
            ]),
        ]);
      };
    },
  });
}
