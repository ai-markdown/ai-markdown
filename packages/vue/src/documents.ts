import {
  computed,
  defineComponent,
  h,
  Fragment,
  provide,
  inject,
  onUnmounted,
  type ComputedRef,
  type DefineComponent,
  type InjectionKey,
} from 'vue';
import { createSmoothCoordinator, type SmoothCoordinator } from '@ai-markdown/core';
import { createRegistry, type RegistryController } from '@ai-markdown/engine';
import type { AIMarkdownDocumentsProps } from './types';

interface DocumentScope {
  acquire(id: string): RegistryController;
  acquireSmooth(id: string): SmoothCoordinator;
  /** The wrapper's orphan policy, read by chunks that set none of their own. */
  preserveOrphanReferences: ComputedRef<boolean>;
}
const documentScope: InjectionKey<DocumentScope> = Symbol('ai-markdown.documents');
/** Scope registries to one Vue component tree. Only explicitly named chunks coordinate. */
export const AIMarkdownDocuments = defineComponent({
  name: 'AIMarkdownDocuments',
  props: {
    preserveOrphanReferences: { type: Boolean, default: true },
  },
  setup(props, { slots }) {
    const registries = new Map<string, RegistryController>();
    const coordinators = new Map<string, SmoothCoordinator>();
    provide(documentScope, {
      preserveOrphanReferences: computed(() => props.preserveOrphanReferences ?? true),
      acquireSmooth(id) {
        let coordinator = coordinators.get(id);
        if (!coordinator) {
          const created = createSmoothCoordinator(() => {
            if (coordinators.get(id) === created) coordinators.delete(id);
          });
          coordinators.set(id, created);
          coordinator = created;
        }
        return coordinator;
      },
      acquire(id) {
        let registry = registries.get(id);
        if (!registry) {
          const created = createRegistry(() => {
            if (registries.get(id) === created) registries.delete(id);
          });
          registries.set(id, created);
          registry = created;
        }
        return registry;
      },
    });
    onUnmounted(() => {
      registries.clear();
      coordinators.clear();
    });
    return () => h(Fragment, slots.default?.());
  },
}) as DefineComponent<AIMarkdownDocumentsProps>;
export function useDocumentScope(): DocumentScope | undefined {
  return inject(documentScope, undefined);
}
