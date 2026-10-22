'use client';
import {
  useEffect,
  useCallback,
  useMemo,
  useSyncExternalStore,
  useState,
  useLayoutEffect,
  type HTMLAttributes,
} from 'react';
import {
  createDiagramController,
  resolveDiagramInterval,
  type DiagramInput,
  type DiagramState,
  type DiagramRequest,
  type DiagramView,
} from '@ai-markdown/core/components';

function createSession(load: DiagramInput['load'], fallback: DiagramInput['fallback'], resetKey: string) {
  let committed = false;
  let state: DiagramState = { view: { kind: 'source' }, loadFailed: false };
  const listeners = new Set<() => void>();
  const controller = createDiagramController(
    load,
    (next) => {
      state = next;
      listeners.forEach((fn) => fn());
    },
    fallback
  );
  return {
    resetKey,
    commit(request: DiagramRequest) {
      committed = true;
      controller.update(request);
    },
    retry(request: DiagramRequest) {
      if (committed) {
        controller.update(request);
        controller.retry();
      }
    },
    dispose() {
      committed = false;
      controller.dispose();
    },
    read: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** No engine imports. Render allocates only; effects commit and clean up the session. */
export function useDiagram(input: DiagramInput) {
  const { load, fallback, resetKey, code, colorScheme, streaming, active, intervalMs } = input;
  const session = useMemo(() => createSession(load, fallback, resetKey), [load, fallback, resetKey]);
  const state = useSyncExternalStore(session.subscribe, session.read, session.read);
  const current = useMemo(
    () => ({ code, dark: colorScheme === 'dark', streaming, active, interval: resolveDiagramInterval(intervalMs) }),
    [code, colorScheme, streaming, active, intervalMs]
  );
  useEffect(() => {
    session.commit(current);
  }, [session, current]);
  useEffect(() => () => session.dispose(), [session]);
  const retry = useCallback(() => session.retry(current), [session, current]);
  return { state, retry };
}

export interface DiagramViewportProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'dangerouslySetInnerHTML'
> {
  view: DiagramView;
}
/** The outer div belongs to React; its contents belong exclusively to the diagram binding. */
export function DiagramViewport({ view, ...props }: DiagramViewportProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!host) return;
    host.replaceChildren();
    if (view.kind !== 'diagram') return;
    let cleanup: void | (() => void);
    try {
      host.innerHTML = view.svg;
      applyDiagramPalette(host, view);
      cleanup = view.bind?.(host);
    } catch (error) {
      host.replaceChildren();
      if (view.onBindError) view.onBindError(error);
      else throw error;
    }
    return () => {
      try {
        cleanup?.();
      } finally {
        host.replaceChildren();
      }
    };
  }, [host, view]);
  return <div {...props} ref={setHost} />;
}

import { applyDiagramPalette } from './diagramPalette';
export { createPeleLoader, createOndineLoader, preloadDiagramEngine } from '@ai-markdown/core/components';
export type { DiagramInput, DiagramState, DiagramView, DiagramEngineLoader } from '@ai-markdown/core/components';
