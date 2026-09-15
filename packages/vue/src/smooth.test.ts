// @vitest-environment jsdom
//
// AIMarkdownSmoothStream mounted under fake timers: the revealed prefix is
// always a prefix of the source, never shrinks, drains once streaming
// ends, is revealed at once by `flush()`, and a pacing switch mid-stream
// keeps all of that. The controller runs on `performance.now` and
// `requestAnimationFrame`, so both are faked and the clock is stepped a
// frame at a time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import type { SmoothStreamPacing } from '@ai-markdown/engine';
import { AIMarkdownSmoothStream } from './smooth';

interface State {
  content: string;
  streaming: boolean;
  pacing: SmoothStreamPacing;
}
let app: App | undefined;
let host: HTMLElement;
let exposed: { flush: () => void } | null = null;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
      'Date',
    ],
  });
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  host.remove();
  vi.useRealTimers();
});

function mount(state: State) {
  app = createApp({
    render: () =>
      h(AIMarkdownSmoothStream, {
        content: state.content,
        streaming: state.streaming,
        pacing: state.pacing,
        coordinate: false,
        streamingCursor: false,
        enginePlugins: [],
        ref: (instance) => {
          exposed = instance as { flush: () => void } | null;
        },
      }),
  });
  app.mount(host);
}
/** Text the reader sees. Plain words render as one paragraph, so the text
 * is the revealed prefix plus the block separator newline. */
const visible = () => (host.querySelector('.aimd-vue')?.textContent ?? '').replace(/\n$/, '');
const busy = () => host.querySelector('.aimd-vue')?.getAttribute('aria-busy');

/** Advance one 16 ms frame and let Vue commit. */
async function frame() {
  vi.advanceTimersByTime(16);
  await nextTick();
}
/** Check the reveal invariants against `previous` and return the new prefix. */
function check(state: State, previous: string): string {
  const now = visible();
  expect(state.content.startsWith(now), `"${now}" is not a prefix of "${state.content}"`).toBe(true);
  expect(now.length, 'the visible prefix shrank').toBeGreaterThanOrEqual(previous.length);
  return now;
}
const words = (count: number, from = 0) => Array.from({ length: count }, (_, i) => `word${from + i}`).join(' ');

describe('AIMarkdownSmoothStream', () => {
  it('reveals a monotone prefix of the source and drains once streaming ends', async () => {
    const state = reactive<State>({ content: 'seed', streaming: true, pacing: 'balanced' });
    mount(state);
    await nextTick();
    // The initial content is complete at mount: nothing hides on hydration.
    expect(visible()).toBe('seed');
    expect(busy()).toBe('true');
    let last = 'seed';
    let animated = false;
    for (let i = 0; i < 12; i++) {
      state.content += ' ' + words(4, i * 4);
      await nextTick();
      for (let f = 0; f < 5; f++) {
        await frame();
        last = check(state, last);
        if (last !== state.content) animated = true;
      }
    }
    // The stream was fast enough that at least one frame lagged the source.
    expect(animated).toBe(true);
    state.streaming = false;
    await nextTick();
    // Streaming stays reported while the backlog drains.
    expect(busy()).toBe('true');
    for (let f = 0; f < 600 && visible() !== state.content; f++) {
      await frame();
      last = check(state, last);
    }
    expect(visible()).toBe(state.content);
    expect(busy()).toBeNull();
  });
  it('flush() reveals the backlog at once', async () => {
    const state = reactive<State>({ content: 'seed', streaming: true, pacing: 'smooth' });
    mount(state);
    await nextTick();
    state.content += ' ' + words(40);
    await nextTick();
    await frame();
    expect(visible().length).toBeLessThan(state.content.length);
    exposed!.flush();
    await nextTick();
    // While the stream is open the trailing grapheme stays held back (it
    // may be half of a cluster); everything before it is up.
    const flushed = visible();
    expect(state.content.startsWith(flushed)).toBe(true);
    expect(flushed.length).toBeGreaterThanOrEqual(state.content.length - 1);
    state.streaming = false;
    await nextTick();
    for (let f = 0; f < 20 && visible() !== state.content; f++) await frame();
    expect(visible()).toBe(state.content);
    expect(busy()).toBeNull();
  });
  it('a pacing switch mid-stream keeps the reveal monotone and still drains', async () => {
    const state = reactive<State>({ content: 'seed', streaming: true, pacing: 'smooth' });
    mount(state);
    await nextTick();
    let last = 'seed';
    for (let i = 0; i < 6; i++) {
      state.content += ' ' + words(6, i * 6);
      await nextTick();
      for (let f = 0; f < 3; f++) {
        await frame();
        last = check(state, last);
      }
    }
    expect(visible().length).toBeLessThan(state.content.length);
    state.pacing = 'responsive';
    await nextTick();
    last = check(state, last);
    for (let i = 6; i < 12; i++) {
      state.content += ' ' + words(6, i * 6);
      await nextTick();
      for (let f = 0; f < 3; f++) {
        await frame();
        last = check(state, last);
      }
    }
    state.pacing = 'balanced';
    await nextTick();
    last = check(state, last);
    state.streaming = false;
    await nextTick();
    for (let f = 0; f < 600 && visible() !== state.content; f++) {
      await frame();
      last = check(state, last);
    }
    expect(visible()).toBe(state.content);
  });
  it('a content replacement snaps instead of animating, and a static update shows at once', async () => {
    const state = reactive<State>({ content: 'seed ' + words(10), streaming: true, pacing: 'balanced' });
    mount(state);
    await nextTick();
    state.content += ' ' + words(20, 10);
    await nextTick();
    await frame();
    expect(visible().length).toBeLessThan(state.content.length);
    // Not an extension of the previous source: no backlog survives.
    state.content = 'replaced ' + words(5);
    await nextTick();
    await frame();
    expect(visible()).toBe(state.content);
    state.streaming = false;
    await nextTick();
    for (let f = 0; f < 20 && busy() !== null; f++) await frame();
    state.content = 'static ' + words(30);
    await nextTick();
    expect(visible()).toBe(state.content);
    expect(busy()).toBeNull();
  });
});
