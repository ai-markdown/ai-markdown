import {
  computed,
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  shallowRef,
  watch,
  watchPostEffect,
  useId,
  type DefineComponent,
  type PropType,
} from 'vue';
import { createSmoothStreamController, type SmoothStreamOptions, type SmoothStreamPacing } from '@ai-markdown/engine';
import type { SmoothCoordinator } from '@ai-markdown/core';
import type { AIMarkdownProps } from './types';
import { useDocumentScope } from './documents';
import { AIMarkdown, markdownProps } from './AIMarkdown';

export interface SmoothStreamInput {
  content: string;
  streaming?: boolean;
  pacing?: SmoothStreamPacing;
}
/** Call during setup. The initial/SSR value is complete; future appends animate. */
export function useSmoothStream(input: () => SmoothStreamInput) {
  const visible = shallowRef(input().content);
  let controller: ReturnType<typeof createSmoothStreamController> | undefined;
  let stop: (() => void) | undefined;
  const liveOptions: SmoothStreamOptions = { pacing: input().pacing };
  onMounted(() => {
    controller = createSmoothStreamController(liveOptions);
    controller.snap(input().content);
    controller.subscribe(() => {
      visible.value = controller!.getVisible();
    });
    visible.value = controller.getVisible();
    stop = watch(
      [() => input().content, () => input().streaming, () => input().pacing],
      ([content, streaming, pacing], previous) => {
        liveOptions.pacing = pacing;
        if (streaming || previous?.[1]) {
          controller!.update(content);
          if (!streaming) controller!.finish();
        } else controller!.snap(content);
      },
      { flush: 'post' }
    );
  });
  onUnmounted(() => {
    stop?.();
    controller?.dispose();
  });
  return {
    content: computed(() => visible.value),
    streaming: computed(() => !!input().streaming || visible.value !== input().content),
    flush: () => controller?.flush(),
  };
}
export interface DocumentSmoothStreamInput extends SmoothStreamInput {
  documentId?: string;
  /** False opts out of document turn-taking. */
  coordinate?: boolean;
}
/** Empty-at-mount chunks wait for preceding registered smooth chunks to drain.
 * Existing nonempty content is never hidden during hydration or a remount.
 */
export function useDocumentSmoothStream(input: () => DocumentSmoothStreamInput) {
  const scope = useDocumentScope();
  const chunkId = useId();
  const coordinator = shallowRef<SmoothCoordinator | null>(null);
  const revision = shallowRef(0);
  const admitted = shallowRef(input().content.length > 0);
  let stop: (() => void) | undefined;
  onMounted(() => {
    stop = watch(
      // Compare selected values, not a newly allocated tuple. A getter may
      // build an options object from a reactive chunk; changing its content
      // must not re-register this slot or admit a waiting successor.
      [() => input().documentId, () => input().coordinate],
      ([id, enabled], _old, cleanup) => {
        admitted.value = input().content.length > 0;
        const current = scope && id !== undefined && enabled !== false ? scope.acquireSmooth(id) : null;
        coordinator.value = current;
        if (!current) return;
        current.register(chunkId);
        const unsubscribe = current.subscribe(() => {
          revision.value++;
        });
        cleanup(() => {
          unsubscribe();
          current.release(chunkId);
          coordinator.value = null;
        });
      },
      { immediate: true, flush: 'post' }
    );
  });
  const pending = computed(() => {
    void revision.value;
    return !admitted.value && coordinator.value !== null && !coordinator.value.isReleased(chunkId);
  });
  const smooth = useSmoothStream(() => ({
    ...input(),
    content: pending.value ? '' : input().content,
    streaming: pending.value || input().streaming,
  }));
  onMounted(() => {
    watchPostEffect(() => {
      if (!pending.value && coordinator.value) {
        admitted.value = true;
        coordinator.value.stampProgress(chunkId, Date.now());
        if (!input().streaming && smooth.content.value === input().content) coordinator.value.markDone(chunkId);
      }
    });
  });
  onUnmounted(() => stop?.());
  return { ...smooth, pending };
}
export const AIMarkdownSmoothStream = defineComponent({
  name: 'AIMarkdownSmoothStream',
  props: {
    ...markdownProps,
    coordinate: { type: Boolean, default: true },
    pacing: { type: String as PropType<SmoothStreamPacing>, default: 'balanced' },
  },
  setup(props, { slots, expose }) {
    const smooth = useDocumentSmoothStream(() => props);
    expose({ flush: smooth.flush });
    return () => {
      if (smooth.pending.value) return h('div', { class: 'aimd-vue-waiting', 'aria-busy': 'true' }, slots.waiting?.());
      // `coordinate` and `pacing` are this component's own props. AIMarkdown
      // does not declare them, so spreading them through would land on its
      // root element as attributes.
      const { coordinate: _coordinate, pacing: _pacing, ...forwarded } = props;
      return h(AIMarkdown, { ...forwarded, content: smooth.content.value, streaming: smooth.streaming.value }, slots);
    };
  },
}) as DefineComponent<AIMarkdownProps & { pacing?: SmoothStreamPacing; coordinate?: boolean }, { flush: () => void }>;
