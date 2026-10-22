import { computed, onBeforeUnmount, onMounted, ref, watch, type ComputedRef } from 'vue';
import { createCodeHighlightSession, type CodeHighlightInput } from '@ai-markdown/core/components';

export function useCodeHighlight(input: ComputedRef<CodeHighlightInput>) {
  const changes = ref(0),
    mounted = ref(false);
  const session = createCodeHighlightSession(() => {
    changes.value++;
  });
  const result = computed(() => {
    void changes.value;
    return session.read(input.value);
  });
  watch(
    [input, mounted, changes],
    ([next, onClient]) => {
      if (onClient) session.commit(next);
    },
    { flush: 'post' }
  );
  onMounted(() => {
    mounted.value = true;
  });
  onBeforeUnmount(() => session.dispose());
  return { result, retry: session.retry };
}
