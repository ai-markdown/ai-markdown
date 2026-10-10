/**
 * Dev-only React hook that warns when a prop's reference identity changes
 * suspiciously often across renders — symptomatic of a caller that defined
 * the value inline instead of at module scope or behind `useMemo` /
 * `useCallback`. The wrapper of `<AIMarkdown>` uses this to flag
 * `urlTransform` and `sanitizeSchema` props that would otherwise silently
 * discard the per-block memo cache on every render.
 *
 * In production builds the entire warning logic is dead-code-eliminated:
 * the dual dev/prod build resolves `process.env.NODE_ENV` at build time
 * (tsdown `env`), so `__DEV__` folds to a constant and the body's
 * `if (!__DEV__) return;` drops the rest. The single `useRef` allocation
 * remains (unconditional, by rules of hooks) but is harmless.
 *
 * History note: this module once gated on
 * `typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'`,
 * which was silently FALSE in bundler browser dev — Vite substitutes only
 * the bare `process.env.NODE_ENV` text and leaves `typeof process`
 * evaluating `'undefined'` in the browser, so these warnings never fired
 * where they mattered most. Bare text everywhere + build-time resolution
 * is the fix; do not reintroduce `typeof process` guards.
 *
 * @module hooks/useReferenceFlipWarning
 */

import { useRef } from 'react';

/** Module-scope dev flag — resolved at build time (see docblock). */
const __DEV__ = process.env.NODE_ENV !== 'production';

/** How many identity flips before the first warning fires. */
const FLIP_THRESHOLD = 3;

/** Minimum delay between successive warnings, milliseconds. */
const WARN_COOLDOWN_MS = 5000;

/** Flips further apart than this restart the count: three theme switches
 *  minutes apart are legitimate changes, not "changing on every render",
 *  and a lifetime counter warned on the third (2026-08 project review,
 *  core-api-06). */
export const FLIP_WINDOW_MS = 10_000;

/** Internal state mutated by {@link trackFlip} across renders. */
export interface FlipState {
  prev: unknown;
  flips: number;
  lastWarnAt: number;
  /** Clock time of the previous flip; absent until the first one. */
  lastFlipAt?: number;
}

/**
 * Pure flip-counting + rate-limiting logic, exported for unit testing.
 *
 * Mutates `state` in place and emits at most one `console.warn` per call.
 * Caller supplies `now` so tests can control the clock without mocking
 * `Date.now()`.
 */
export function trackFlip(state: FlipState, value: unknown, propName: string, now: number): void {
  if (state.prev === value) return;
  if (state.lastFlipAt !== undefined && now - state.lastFlipAt > FLIP_WINDOW_MS) state.flips = 0;
  state.lastFlipAt = now;
  state.flips++;
  state.prev = value;
  if (state.flips < FLIP_THRESHOLD) return;
  if (now - state.lastWarnAt < WARN_COOLDOWN_MS) return;
  state.lastWarnAt = now;
  console.warn(
    `[AIMarkdown] \`${propName}\` reference is changing on every render. ` +
      `Define it at module scope or wrap with useMemo/useCallback to avoid ` +
      `discarding the per-block memo cache on every parent re-render.`
  );
}

/**
 * Track a value across renders and emit a dev-only warning when its
 * reference identity flips frequently.
 *
 * @param value - The prop value to monitor (function, object, or any
 *   reference type whose identity should be stable).
 * @param propName - Human-readable name used in the warning text.
 */
export default function useReferenceFlipWarning<T>(value: T, propName: string): void {
  // useRef must be called unconditionally — rules of hooks. The seed value
  // matches `value` so the first render does not count as a flip. Sentinel
  // `-Infinity` for `lastWarnAt` ensures the first warn-eligible event is
  // never blocked by the cooldown comparison.
  const stateRef = useRef<FlipState>({ prev: value, flips: 0, lastWarnAt: -Infinity });
  if (!__DEV__) return;
  // Intentional render-time `Date.now()`: this hook's whole purpose is to
  // observe wall-clock cooldowns between flip events. Routing the timestamp
  // through useMemo/useEffect would either pin it to a value-change snapshot
  // (wrong semantics for a wall-clock cooldown) or delay it by a commit
  // (loses the very render where the flip happened).
  // eslint-disable-next-line react-hooks/purity
  trackFlip(stateRef.current, value, propName, Date.now());
}
