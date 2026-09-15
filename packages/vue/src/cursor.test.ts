// @vitest-environment jsdom
//
// The streaming cursor under jsdom: what it reads from the tail marker,
// which tails keep it hidden, and that every observer, listener and frame
// it took out is released on unmount. jsdom lays nothing out, so a range
// never has client rectangles and the marker can never become visible
// here; the branch a measurement took is read from whether it reached
// `document.createRange` and on which text node.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, type App } from 'vue';
import { AIMarkdownStreamingCursor } from './cursor';

type Callback = (...args: unknown[]) => void;
/** Every observer the cursor constructs, with its callback and spies. */
const observers: {
  kind: 'mutation' | 'resize';
  callback: Callback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}[] = [];
/** Pending animation frames by id. */
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const runFrames = () => {
  const due = [...frames.entries()];
  frames.clear();
  for (const [, callback] of due) callback(0);
};

beforeEach(() => {
  observers.length = 0;
  frames.clear();
  nextFrame = 1;
  const make = (kind: 'mutation' | 'resize') =>
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: Callback) {
        observers.push({ kind, callback, observe: this.observe, disconnect: this.disconnect });
      }
    };
  vi.stubGlobal('MutationObserver', make('mutation'));
  vi.stubGlobal('ResizeObserver', make('resize'));
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    })
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => {
      frames.delete(id);
    })
  );
  // jsdom's Range has no client rectangles at all; an empty list is what a
  // browser reports for a range that has no layout box yet.
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
});
afterEach(() => {
  delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/** Mount a root `div` holding `children` and the cursor last, as AIMarkdown does. */
function mount(children: () => ReturnType<typeof h>[]): { app: App; root: HTMLElement; marker: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () =>
      h('div', { class: 'aimd-vue', style: { position: 'relative' } }, [...children(), h(AIMarkdownStreamingCursor)]),
  });
  app.mount(host);
  const root = host.firstElementChild as HTMLElement;
  const marker = root.querySelector<HTMLElement>('.aimd-vue-cursor')!;
  return { app, root, marker };
}
const tail = (kind: string, extra: Record<string, string> = {}) =>
  h('span', { 'data-aimd-tail-kind': kind, 'data-aimd-clobber-prefix': 'doc-', style: { display: 'none' }, ...extra });

describe('AIMarkdownStreamingCursor', () => {
  it('observes its parent on mount and measures on the next frame', () => {
    const { app, root, marker } = mount(() => [h('p', 'hello')]);
    expect(marker.parentElement).toBe(root);
    expect(marker.getAttribute('aria-hidden')).toBe('true');
    expect(marker.style.visibility).toBe('hidden');
    const [mutation, resize] = observers;
    expect(mutation.kind).toBe('mutation');
    expect(mutation.observe).toHaveBeenCalledWith(root, { childList: true, characterData: true, subtree: true });
    expect(resize.kind).toBe('resize');
    expect(resize.observe).toHaveBeenCalledWith(root);
    expect(frames.size).toBe(1);
    const range = vi.spyOn(document, 'createRange');
    runFrames();
    // The trailing text branch was followed down to "hello".
    expect(range).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    app.unmount();
  });
  it('coalesces mutation, resize, scroll and window resize signals into one pending frame', () => {
    const { app, root } = mount(() => [h('p', 'hello')]);
    runFrames();
    expect(frames.size).toBe(0);
    for (const observer of observers) observer.callback([]);
    root.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(1);
    app.unmount();
  });
  it('stays hidden and skips measuring while the tail is an invisible definition', () => {
    const { app, marker } = mount(() => [h('p', 'See site.'), tail('invisible-def')]);
    const range = vi.spyOn(document, 'createRange');
    runFrames();
    expect(range).not.toHaveBeenCalled();
    expect(marker.style.visibility).toBe('hidden');
    app.unmount();
  });
  it('follows a footnote-definition tail into the matching footer item, or nowhere', () => {
    const footnotes = (id: string) =>
      h('section', { 'data-footnotes': '' }, [h('ol', [h('li', { id }, [h('p', 'footnote body')])])]);
    const missing = mount(() => [
      h('p', 'Claim.'),
      footnotes('doc-fn-other'),
      tail('footnote-def', { 'data-aimd-tail-label': 'n' }),
    ]);
    const range = vi.spyOn(document, 'createRange');
    runFrames();
    expect(range).not.toHaveBeenCalled();
    missing.app.unmount();

    const present = mount(() => [
      h('p', 'Claim.'),
      footnotes('doc-fn-n'),
      tail('footnote-def', { 'data-aimd-tail-label': 'n' }),
    ]);
    range.mockClear();
    runFrames();
    expect(range).toHaveBeenCalledTimes(1);
    const measured = range.mock.results[0].value as Range;
    expect(measured.startContainer.textContent).toBe('footnote body');
    expect(measured.startContainer.parentElement?.closest('li')?.id).toBe('doc-fn-n');
    present.app.unmount();
  });
  it('hides on a code, math or image tail instead of pointing at an earlier paragraph', () => {
    const cases = [
      [h('p', 'before'), h('pre', [h('code', 'x = 1')])],
      [h('p', 'before'), h('span', { class: 'katex' }, 'x')],
      [h('p', ['before ', h('img', { src: 'a.png' })])],
    ];
    for (const children of cases) {
      const { app, marker } = mount(() => children);
      const range = vi.spyOn(document, 'createRange');
      runFrames();
      expect(range).not.toHaveBeenCalled();
      expect(marker.style.visibility).toBe('hidden');
      range.mockRestore();
      app.unmount();
    }
  });
  it('disconnects observers, listeners and the pending frame on unmount', () => {
    const { app, root } = mount(() => [h('p', 'hello')]);
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const rootRemove = vi.spyOn(root, 'removeEventListener');
    // A frame is pending from mount; it must be cancelled, not run later.
    expect(frames.size).toBe(1);
    const [pending] = frames.keys();
    app.unmount();
    for (const observer of observers) expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(pending);
    expect(frames.size).toBe(0);
    expect(windowRemove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(rootRemove).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    // Signals after unmount schedule nothing.
    for (const observer of observers) observer.callback([]);
    window.dispatchEvent(new Event('resize'));
    expect(frames.size).toBe(0);
  });
});
