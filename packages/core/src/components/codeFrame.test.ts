import { afterEach, expect, test, vi } from 'vitest';
import { createCodeFrame, nextCodeFrame, type CodeFrame } from './codeFrame';

let previous: CodeFrame | undefined;
afterEach(() => {
  vi.useRealTimers();
  previous = undefined;
});
const frame = (code: string, language = 'js') => (previous = nextCodeFrame(previous, code, language));
const matches = (code: string, language = 'js') => expect.objectContaining({ code, language });

test('continuity checks the entire prefix, including an edit far from either end', () => {
  const start = frame('a'.repeat(1000));
  expect(frame(start.code + 'b').generation).toBe(start.generation);
  const replaced = frame('a'.repeat(500) + 'X' + 'a'.repeat(500) + 'bc');
  expect(replaced.generation).not.toBe(start.generation);
  expect(frame(replaced.code).generation).toBe(replaced.generation);
  expect(frame(replaced.code, 'python').generation).not.toBe(replaced.generation);
});

test('continuous appends publish at fixed deadlines, including the trailing frame', () => {
  vi.useFakeTimers();
  const publish = vi.fn();
  const controller = createCodeFrame(frame(''), publish);
  for (let i = 1; i <= 100; i++) {
    controller.update(frame('x'.repeat(i)), true, 50);
    vi.advanceTimersByTime(5);
  }
  expect(publish).toHaveBeenCalledTimes(10);
  expect(publish.mock.calls.map(([value]) => value.code.length)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  controller.update(frame('x'.repeat(101)), true, 50);
  vi.advanceTimersByTime(50);
  expect(publish).toHaveBeenLastCalledWith(matches('x'.repeat(101)));
});

test('completion immediately flushes the latest text and cancels an older pending frame', () => {
  vi.useFakeTimers();
  const publish = vi.fn();
  const controller = createCodeFrame(frame('a'), publish);
  controller.update(frame('ab'), true, 50);
  controller.update(frame('abc'), false, 50);
  expect(publish).toHaveBeenCalledExactlyOnceWith(matches('abc'));
  vi.runAllTimers();
  expect(publish).toHaveBeenCalledTimes(1);
});

test('same-length and longer replacements plus language changes bypass the pending timer', () => {
  vi.useFakeTimers();
  const publish = vi.fn();
  const controller = createCodeFrame(frame('a'), publish);
  controller.update(frame('abc'), true, 50);
  controller.update(frame('abd'), true, 50);
  expect(publish).toHaveBeenLastCalledWith(matches('abd'));
  controller.update(frame('axyz'), true, 50);
  expect(publish).toHaveBeenLastCalledWith(matches('axyz'));
  controller.update(frame('axyz', 'python'), true, 50);
  expect(publish).toHaveBeenLastCalledWith(matches('axyz', 'python'));
  vi.runAllTimers();
  expect(publish).toHaveBeenCalledTimes(3);
});

test('zero interval and static updates never schedule timers', () => {
  vi.useFakeTimers();
  const publish = vi.fn();
  const controller = createCodeFrame(frame('a'), publish);
  controller.update(frame('ab'), true, 0);
  controller.update(frame('abc'), false, 50);
  expect(publish).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

test('unmount cancels pending work and Strict Mode replay can schedule it again', () => {
  vi.useFakeTimers();
  const publish = vi.fn();
  const controller = createCodeFrame(frame('a'), publish);
  controller.update(frame('ab'), true, 50);
  controller.dispose();
  vi.runAllTimers();
  expect(publish).not.toHaveBeenCalled();
  controller.update(frame('ab'), true, 50);
  vi.advanceTimersByTime(50);
  expect(publish).toHaveBeenCalledExactlyOnceWith(matches('ab'));
});

test('changing the interval replaces the deadline and removes stale work', () => {
  vi.useFakeTimers();
  const publish = vi.fn();
  const controller = createCodeFrame(frame('a'), publish);
  controller.update(frame('ab'), true, 500);
  controller.update(frame('abc'), true, 50);
  vi.advanceTimersByTime(50);
  expect(publish).toHaveBeenCalledExactlyOnceWith(matches('abc'));
  expect(vi.getTimerCount()).toBe(0);
});
