// @vitest-environment jsdom
//
// The `useCodeFrame` hook around `createCodeFrame`: what a component sees
// per render, not what the controller publishes. Timers are faked so the
// throttle is measured against a clock.
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useCodeFrame } from './useCodeFrame';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

interface Props {
  code: string;
  language?: string;
  streaming: boolean;
  interval?: number;
}
/** Every value the hook returned, in render order. */
const seen: string[] = [];
const Probe = ({ code, language = 'js', streaming, interval = 50 }: Props) => {
  const frame = useCodeFrame(code, language, streaming, interval);
  seen.push(frame);
  return <output>{frame}</output>;
};

let root: Root | undefined;
let container: HTMLElement | undefined;
const shown = () => container!.querySelector('output')!.textContent;
async function render(props: Props) {
  if (!root) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(<Probe {...props} />);
  });
}
async function unmount() {
  if (!root) return;
  await act(async () => root!.unmount());
  container!.remove();
  root = undefined;
}
const tick = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

afterEach(async () => {
  await unmount();
  seen.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('outside streaming every update passes through at once, with no timer', async () => {
  vi.useFakeTimers();
  await render({ code: 'a', streaming: false });
  expect(shown()).toBe('a');
  await render({ code: 'ab', streaming: false });
  expect(shown()).toBe('ab');
  await render({ code: 'x', streaming: false });
  expect(shown()).toBe('x');
  // The controller publishes the frame it was told about, which is one
  // more render with the same text, never an older one.
  expect(seen).toEqual(['a', 'ab', 'ab', 'x', 'x']);
  expect(vi.getTimerCount()).toBe(0);
  // A zero interval while streaming is the same pass-through.
  await render({ code: 'xy', streaming: true, interval: 0 });
  expect(shown()).toBe('xy');
  expect(vi.getTimerCount()).toBe(0);
});

test('streamed appends show the previous frame until the interval elapses, then the latest text', async () => {
  vi.useFakeTimers();
  await render({ code: 'a', streaming: true });
  await render({ code: 'ab', streaming: true });
  await tick(10);
  await render({ code: 'abc', streaming: true });
  expect(shown()).toBe('a');
  expect(vi.getTimerCount()).toBe(1);
  // The deadline is measured from the first pending append, not the last.
  await tick(39);
  expect(shown()).toBe('a');
  await tick(1);
  expect(shown()).toBe('abc');
  expect(vi.getTimerCount()).toBe(0);
  // The next burst opens a new window.
  await render({ code: 'abcd', streaming: true });
  expect(shown()).toBe('abc');
  await tick(50);
  expect(shown()).toBe('abcd');
});

test('a replacement or a language change shows at once and drops the pending frame', async () => {
  vi.useFakeTimers();
  await render({ code: 'abc', streaming: true });
  await render({ code: 'abcd', streaming: true });
  expect(shown()).toBe('abc');
  await render({ code: 'abX', streaming: true });
  expect(shown()).toBe('abX');
  expect(vi.getTimerCount()).toBe(0);
  await render({ code: 'abXY', streaming: true });
  expect(shown()).toBe('abX');
  await render({ code: 'abXY', language: 'python', streaming: true });
  expect(shown()).toBe('abXY');
  expect(vi.getTimerCount()).toBe(0);
  // Whatever the timer would have shown is stale; nothing changes later.
  await tick(200);
  expect(shown()).toBe('abXY');
});

test('the end of the stream flushes the latest text immediately', async () => {
  vi.useFakeTimers();
  await render({ code: 'a', streaming: true });
  await render({ code: 'ab', streaming: true });
  expect(shown()).toBe('a');
  await render({ code: 'abc', streaming: false });
  expect(shown()).toBe('abc');
  expect(vi.getTimerCount()).toBe(0);
});

test('unmount cancels the pending frame and no update reaches the unmounted component', async () => {
  vi.useFakeTimers();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await render({ code: 'a', streaming: true });
  await render({ code: 'ab', streaming: true });
  expect(vi.getTimerCount()).toBe(1);
  const renders = seen.length;
  await unmount();
  expect(vi.getTimerCount()).toBe(0);
  await tick(200);
  expect(seen.length).toBe(renders);
  expect(error).not.toHaveBeenCalled();
});
