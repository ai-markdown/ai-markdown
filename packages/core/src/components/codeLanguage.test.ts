import { afterEach, expect, test, vi } from 'vitest';
import { createCodeLanguageTracker } from './codeLanguage';

afterEach(() => vi.useRealTimers());

const python = 'def add(a, b):\n    return a + b\n\nprint(add(1, 2))\n';
const typescript = `${Array.from({ length: 4 }, (_, i) => `export const value${i}: number = ${i} as number;`).join('\n')}\n`;
/** hast code text as it streams: every frame ends with a newline. */
const frames = (text: string) =>
  Array.from(
    { length: Math.ceil(text.length / 4) },
    (_, i) => `${text.slice(0, Math.min((i + 1) * 4, text.length - 1))}\n`
  );

test('a short streaming block has no verdict until its text settles', () => {
  vi.useFakeTimers();
  const onSettle = vi.fn();
  const tracker = createCodeLanguageTracker(onSettle);
  let verdict: string | null = null;
  for (const frame of frames(python)) {
    verdict = tracker.read(frame, true);
    tracker.observe(frame, true);
    vi.advanceTimersByTime(20);
  }
  // Fewer than 80 characters arrived after the first look, so the detector has not looked again.
  expect(verdict).toBeNull();
  expect(onSettle).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300);
  expect(onSettle).toHaveBeenCalledTimes(1);
  expect(tracker.read(python, true)).toBe('python');
  // The settled text needs no further timer.
  tracker.observe(python, true);
  vi.advanceTimersByTime(1000);
  expect(onSettle).toHaveBeenCalledTimes(1);
});

test('a complete block is judged at once', () => {
  const tracker = createCodeLanguageTracker(() => {});
  expect(tracker.read(python, false)).toBe('python');
  expect(tracker.read(python, false)).toBe('python');
});

test('a rewritten streaming block drops the old verdict at once', () => {
  const handlers = `${Array.from({ length: 4 }, (_, i) => `def handler_${i}(request):\n    import os\n    return None`).join('\n')}\n`;
  const tracker = createCodeLanguageTracker(() => {});
  expect(tracker.read(typescript, true)).toBe('typescript');
  // Longer than the old text by less than 80 characters, so the detector alone would not look again.
  expect(handlers.length - typescript.length).toBeGreaterThan(0);
  expect(handlers.length - typescript.length).toBeLessThan(80);
  expect(tracker.read(handlers, true)).toBe('python');
});

test('dispose cancels the pending settle, and a later observe starts a new one', () => {
  vi.useFakeTimers();
  const onSettle = vi.fn();
  const tracker = createCodeLanguageTracker(onSettle);
  tracker.read(python, true);
  tracker.observe(python, true);
  tracker.dispose();
  vi.advanceTimersByTime(1000);
  expect(onSettle).not.toHaveBeenCalled();
  tracker.observe(python, true);
  vi.advanceTimersByTime(300);
  expect(onSettle).toHaveBeenCalledTimes(1);
});
