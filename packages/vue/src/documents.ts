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
  /** Identity token of a document in this wrapper; see `AIMarkdownDocumentInfo.scope`. */
  acquireScope(id: string): object;
  /** The wrapper's orphan policy, read by chunks that set none of their own. */
  preserveOrphanReferences: ComputedRef<boolean>;
}
const documentScope: InjectionKey<DocumentScope> = Symbol('ai-markdown.documents');

/** One token per document id. A token has no registrations to count, so it is
 * held weakly and dropped when the last renderer using it is collected. */
function createScopeTokens() {
  if (typeof WeakRef !== 'function' || typeof FinalizationRegistry !== 'function') {
    const strong = new Map<string, object>();
    return {
      get(id: string): object {
        let token = strong.get(id);
        if (!token) strong.set(id, (token = {}));
        return token;
      },
      clear: () => strong.clear(),
    };
  }
  const entries = new Map<string, WeakRef<object>>();
  const collected = new FinalizationRegistry<{ id: string; ref: WeakRef<object> }>(({ id, ref }) => {
    // Collection can arrive after a new token took this id.
    if (entries.get(id) === ref) entries.delete(id);
  });
  return {
    get(id: string): object {
      const existing = entries.get(id)?.deref();
      if (existing) return existing;
      const token = {};
      const ref = new WeakRef(token);
      entries.set(id, ref);
      collected.register(token, { id, ref });
      return token;
    },
    clear: () => entries.clear(),
  };
}

export interface AIMarkdownDocumentInfo {
  /** Resolved document id: the `documentId` prop, or a generated one. */
  documentId: ComputedRef<string>;
  /**
   * Identity of this document, for state that belongs to the document rather
   * than to one renderer (a `WeakMap` key, for example). Renderers that share
   * a `documentId` inside `<AIMarkdownDocuments>` share one object; any other
   * renderer has its own.
   */
  scope: ComputedRef<object>;
}
// A registered symbol: the development build of the base entry is a separate
// bundle, and the component entries must still find what it provides.
const documentInfo: InjectionKey<AIMarkdownDocumentInfo> = Symbol.for('ai-markdown.document');
export function provideDocumentInfo(info: AIMarkdownDocumentInfo): void {
  provide(documentInfo, info);
}
/** The document of the enclosing `<AIMarkdown>`. Call it in the setup of a component rendered by one. */
export function useAIMarkdownDocument(): AIMarkdownDocumentInfo {
  const info = inject(documentInfo, undefined);
  if (!info) throw new Error('useAIMarkdownDocument must be called inside <AIMarkdown>.');
  return info;
}
/** For the supplied components, which also render outside a Markdown instance in tests and stories. */
export function useOptionalAIMarkdownDocument(): AIMarkdownDocumentInfo | undefined {
  return inject(documentInfo, undefined);
}
/** Scope registries to one Vue component tree. Only explicitly named chunks coordinate. */
export const AIMarkdownDocuments = defineComponent({
  name: 'AIMarkdownDocuments',
  props: {
    preserveOrphanReferences: { type: Boolean, default: true },
  },
  setup(props, { slots }) {
    const registries = new Map<string, RegistryController>();
    const coordinators = new Map<string, SmoothCoordinator>();
    const scopes = createScopeTokens();
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
      acquireScope: scopes.get,
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
      scopes.clear();
    });
    return () => h(Fragment, slots.default?.());
  },
}) as DefineComponent<AIMarkdownDocumentsProps>;
export function useDocumentScope(): DocumentScope | undefined {
  return inject(documentScope, undefined);
}
