import { computed, onBeforeUnmount, onMounted, ref, watch, type ComputedRef } from 'vue';
import { createCodeBlockSession, type CodeBlockInput } from '@ai-markdown/core/components';

/** Vue lifecycle binding for the same session used by React. */
export function useCodeBlock(input: ComputedRef<CodeBlockInput>) {
  const changes = ref(0),
    mounted = ref(false);
  const session = createCodeBlockSession(() => {
    changes.value++;
  });
  const block = computed(() => {
    void changes.value;
    return session.read(input.value);
  });
  watch(
    [input, mounted],
    ([next, onClient]) => {
      if (onClient) session.commit(next);
    },
    { flush: 'post' }
  );
  onMounted(() => {
    mounted.value = true;
  });
  onBeforeUnmount(() => session.dispose());
  return block;
}
