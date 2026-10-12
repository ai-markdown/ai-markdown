import { expect, test } from 'vitest';
import { createRenderQueue } from './renderQueue';

test('serializes owners, coalesces superseded frames, and cancels unmounted owners', async () => {
  const queue = createRenderQueue();
  const events: string[] = [];
  const a = {},
    b = {},
    gone = {};
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queue.enqueue(a, async () => {
    events.push('a:start');
    await barrier;
    events.push('a:end');
  });
  const skipped = queue.enqueue(b, async () => {
    events.push('b:stale');
  });
  const final = queue.enqueue(b, async () => {
    events.push('b:final');
  });
  const removed = queue.enqueue(gone, async () => {
    events.push('gone');
  });
  queue.cancel(gone);
  await Promise.all([skipped, removed]);
  expect(events).toEqual(['a:start']);
  release();
  await Promise.all([first, final]);
  expect(events).toEqual(['a:start', 'a:end', 'b:final']);
});

test('a failed task does not poison later diagrams', async () => {
  const queue = createRenderQueue();
  const failed = queue.enqueue({}, async () => {
    throw new Error('bad diagram');
  });
  let ran = false;
  const next = queue.enqueue({}, async () => {
    ran = true;
  });
  await expect(failed).rejects.toThrow('bad diagram');
  await next;
  expect(ran).toBe(true);
});
